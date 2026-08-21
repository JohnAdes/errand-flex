import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db, schema } from "../../db";
import { NotFoundError, ValidationError, ForbiddenError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { ORDER_STATUS_TRANSITIONS, OrderStatus } from "@courier/shared-types";

type DbOrTx = NodePgDatabase<typeof schema>;

interface CreateOrderInput {
  actorUserId: string;
  customerProfileId: string;
  quoteId: string;
  serviceLevel: "ECONOMY" | "STANDARD" | "PRIORITY" | "SCHEDULED";
  pickup: { line1: string; city: string; state: string; postal: string; lat: number; lng: number };
  dropoff: {
    line1: string;
    city: string;
    state: string;
    postal: string;
    lat: number;
    lng: number;
    recipientName: string;
    recipientPhone: string;
  };
  packages: Array<{
    category: string;
    weightKg: number;
    quantity: number;
    declaredValueCents: number;
    fragile: boolean;
    perishable: boolean;
    confidential: boolean;
  }>;
  deliveryInstructions?: string;
  contactlessDelivery: boolean;
}

/**
 * Consumes a valid, unexpired quote and creates the order + packages + stops
 * in a single transaction. This is the point where a server-authoritative
 * price gets locked to an order — the client never supplies a price (per
 * 02-architecture.md §11 security model / 01-product-specification.md §7).
 */
export async function createOrder(input: CreateOrderInput) {
  return db.transaction(async (tx) => {
    const quote = await tx.query.quotes.findFirst({ where: eq(schema.quotes.id, input.quoteId) });
    if (!quote) throw new NotFoundError("Quote", input.quoteId);
    if (quote.expiresAt < new Date()) {
      throw new ValidationError("This quote has expired — request a new one");
    }
    const alreadyUsed = await tx.query.orders.findFirst({ where: eq(schema.orders.quoteId, quote.id) });
    if (alreadyUsed) throw new ValidationError("This quote has already been used for another order");

    if (input.packages.length === 0) throw new ValidationError("At least one package is required");

    const [pickupAddress] = await tx
      .insert(schema.addresses)
      .values({
        customerProfileId: input.customerProfileId,
        line1: input.pickup.line1,
        city: input.pickup.city,
        state: input.pickup.state,
        postal: input.pickup.postal,
        lat: input.pickup.lat,
        lng: input.pickup.lng,
      })
      .returning();

    const [dropoffAddress] = await tx
      .insert(schema.addresses)
      .values({
        customerProfileId: input.customerProfileId,
        line1: input.dropoff.line1,
        city: input.dropoff.city,
        state: input.dropoff.state,
        postal: input.dropoff.postal,
        lat: input.dropoff.lat,
        lng: input.dropoff.lng,
      })
      .returning();

    const [order] = await tx
      .insert(schema.orders)
      .values({
        customerProfileId: input.customerProfileId,
        status: "AWAITING_PAYMENT",
        serviceLevel: input.serviceLevel as any,
        quoteId: quote.id,
        totalCents: quote.totalCents,
        currency: quote.currency,
        deliveryInstructions: input.deliveryInstructions,
        contactlessDelivery: input.contactlessDelivery,
        // Previously never set — quotes.pricingRuleVersionId was populated
        // at quote time but never copied onto the order, so anything
        // querying orders.pricingRuleVersionId directly (rather than joining
        // through quoteId) always got null, silently losing the "which
        // pricing-rule version priced this order" audit trail.
        pricingRuleVersionId: quote.pricingRuleVersionId,
      })
      .returning();

    const packages = await tx
      .insert(schema.packages)
      .values(
        input.packages.map((p) => ({
          orderId: order.id,
          category: p.category as any,
          weightKg: p.weightKg,
          quantity: p.quantity,
          declaredValueCents: p.declaredValueCents,
          fragile: p.fragile,
          perishable: p.perishable,
          confidential: p.confidential,
        }))
      )
      .returning();

    const stops = await tx
      .insert(schema.stops)
      .values([
        { orderId: order.id, type: "PICKUP", addressId: pickupAddress.id, sequenceNo: 1 },
        {
          orderId: order.id,
          type: "DROPOFF",
          addressId: dropoffAddress.id,
          sequenceNo: 2,
          recipientName: input.dropoff.recipientName,
          recipientPhone: input.dropoff.recipientPhone,
        },
      ])
      .returning();

    await recordAudit(tx, {
      actorId: input.actorUserId,
      action: "ORDER_CREATED",
      entityType: "Order",
      entityId: order.id,
      after: { status: order.status, totalCents: order.totalCents },
    });

    return { ...order, packages, stops };
  });
}

export async function getOrder(orderId: string, requesterCustomerProfileId?: string) {
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, orderId),
    with: {
      packages: true,
      stops: { with: { address: true } },
      pickupVerification: true,
      deliveryVerification: true,
      payment: true,
    },
  });
  if (!order) throw new NotFoundError("Order", orderId);

  // Object-level authorization: a customer may only fetch their own orders
  // (02-architecture.md §11 — enforced in the service layer, not just routing).
  if (requesterCustomerProfileId && order.customerProfileId !== requesterCustomerProfileId) {
    throw new ForbiddenError("You do not have access to this order");
  }

  return order;
}

export async function listOrdersForCustomer(customerProfileId: string) {
  return db.query.orders.findMany({
    where: eq(schema.orders.customerProfileId, customerProfileId),
    orderBy: (orders, { desc }) => [desc(orders.createdAt)],
    with: { packages: true },
  });
}

/**
 * Marks payment authorized and moves the order into the dispatch pipeline.
 * Called by the payment service after Stripe confirms authorization — never
 * directly by a client.
 */
export async function markPaymentAuthorizedAndSchedule(orderId: string) {
  const scheduled = await transitionOrder(orderId, OrderStatus.SCHEDULED, "system:payment", {
    reason: "Payment authorized",
  });
  // Immediately move into dispatch search — a real system would do this via
  // a queued job so a slow dispatch cycle doesn't block the payment webhook
  // response. See 02-architecture.md §7 (Event & Job Architecture).
  return transitionOrder(scheduled.id, OrderStatus.SEARCHING_FOR_DRIVER, "system:dispatch", {});
}

export async function cancelOrder(orderId: string, actorUserId: string, requesterCustomerProfileId?: string) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order", orderId);

  // Object-level authorization, same pattern as getOrder above — found
  // missing by a code review pass: any authenticated customer could
  // previously cancel any other customer's order by guessing/observing its
  // UUID. `requesterCustomerProfileId` is only passed for the CUSTOMER role;
  // staff (dispatcher/ops/admin) can cancel any order, same as before.
  if (requesterCustomerProfileId && order.customerProfileId !== requesterCustomerProfileId) {
    throw new ForbiddenError("You do not have access to this order");
  }

  const cancelableStatuses: OrderStatus[] = [
    OrderStatus.DRAFT,
    OrderStatus.QUOTE_GENERATED,
    OrderStatus.AWAITING_PAYMENT,
    OrderStatus.SCHEDULED,
    OrderStatus.SEARCHING_FOR_DRIVER,
  ];
  if (!cancelableStatuses.includes(order.status as OrderStatus)) {
    throw new ValidationError(
      `Order cannot be canceled from status ${order.status} — it has already progressed past the cancellation window`
    );
  }

  return transitionOrder(orderId, OrderStatus.CANCELED, actorUserId, { reason: "Customer cancellation" });
}

async function doTransitionOrder(
  tx: DbOrTx,
  orderId: string,
  toStatus: OrderStatus,
  actorId: string,
  meta: Record<string, unknown>
) {
  const order = await tx.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order", orderId);

  const allowedNext = ORDER_STATUS_TRANSITIONS[order.status as OrderStatus] ?? [];
  if (!allowedNext.includes(toStatus)) {
    throw new ValidationError(
      `Invalid transition: ${order.status} -> ${toStatus}. Allowed: ${allowedNext.join(", ") || "(none — terminal state)"}`
    );
  }

  const [updated] = await tx
    .update(schema.orders)
    .set({ status: toStatus as any, updatedAt: new Date() })
    .where(eq(schema.orders.id, orderId))
    .returning();

  await recordAudit(tx, {
    actorId,
    action: `ORDER_STATUS_${toStatus}`,
    entityType: "Order",
    entityId: orderId,
    before: { status: order.status },
    after: { status: toStatus, meta },
  });

  return updated;
}

/**
 * Server-authoritative state machine transition. This is the ONLY function in
 * the codebase allowed to change an order's status — every route handler
 * that changes order state must go through this so the transition map is
 * enforced everywhere (01-product-specification.md §8).
 *
 * Accepts an optional outer transaction handle (`tx`) so a caller that's
 * already inside its own `db.transaction` — e.g. custody.service.ts's
 * pickup/delivery verification — can pass it through and have the status
 * change commit or roll back atomically with the rest of that transaction.
 * Found by review to previously always open its own independent transaction
 * regardless of caller context: a later failure in the outer transaction
 * would roll back, but this function's own transaction had already
 * committed, leaving the order stuck mid-transition with a committed audit
 * entry claiming a change that didn't actually complete. When no `tx` is
 * passed, this still wraps itself in its own transaction as before.
 */
export async function transitionOrder(
  orderId: string,
  toStatus: OrderStatus,
  actorId: string,
  meta: Record<string, unknown>,
  tx?: DbOrTx
) {
  if (tx) return doTransitionOrder(tx, orderId, toStatus, actorId, meta);
  return db.transaction((innerTx) => doTransitionOrder(innerTx, orderId, toStatus, actorId, meta));
}

/**
 * Walks the order through every intermediate state required to reach
 * `toStatus` from its current status, via breadth-first search over
 * ORDER_STATUS_TRANSITIONS.
 *
 * Why this exists: driver-facing actions like "confirm pickup" conceptually
 * skip states a real driver app would pass through explicitly (en-route,
 * arrived) — the GPS-radius pass at verification time IS the "arrived"
 * signal in this starter kit, since there's no separate en-route/arrived
 * button implemented yet (see custody.routes.ts / the driver-app scaffold
 * TODOs). Rather than silently short-circuiting the state machine (which
 * would violate the "only transitionOrder changes status" rule and make the
 * audit trail lie about what happened), this walks through and logs every
 * intermediate state for real, one transitionOrder() call per hop, so the
 * audit log accurately shows
 * DRIVER_ASSIGNED -> EN_ROUTE -> ARRIVED -> VERIFICATION_IN_PROGRESS
 * rather than jumping straight to the last one.
 *
 * Added after actually running the pickup-verification flow end-to-end and
 * hitting "Invalid transition: DRIVER_ASSIGNED -> PICKUP_VERIFICATION_IN_PROGRESS"
 * — a real bug caught by testing, not a hypothetical.
 */
export async function transitionOrderThrough(
  orderId: string,
  toStatus: OrderStatus,
  actorId: string,
  meta: Record<string, unknown>,
  tx?: DbOrTx
) {
  const dbOrTx = tx ?? db;
  const order = await dbOrTx.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order", orderId);

  const fromStatus = order.status as OrderStatus;
  if (fromStatus === toStatus) return order;

  const path = findTransitionPath(fromStatus, toStatus);
  if (!path) {
    throw new ValidationError(`No valid path from ${fromStatus} to ${toStatus}`);
  }

  let current: Awaited<ReturnType<typeof transitionOrder>> = order as any;
  for (const step of path) {
    current = await transitionOrder(orderId, step, actorId, meta, tx);
  }
  return current;
}

function findTransitionPath(from: OrderStatus, to: OrderStatus): OrderStatus[] | null {
  const queue: Array<{ status: OrderStatus; path: OrderStatus[] }> = [{ status: from, path: [] }];
  const visited = new Set<OrderStatus>([from]);

  while (queue.length > 0) {
    const { status, path } = queue.shift()!;
    const nextStates = ORDER_STATUS_TRANSITIONS[status] ?? [];
    for (const next of nextStates) {
      if (next === to) return [...path, next];
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ status: next, path: [...path, next] });
      }
    }
  }
  return null;
}
