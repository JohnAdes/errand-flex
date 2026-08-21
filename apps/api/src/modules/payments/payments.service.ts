import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db, schema } from "../../db";
import { NotFoundError, ValidationError, ConflictError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { paymentProvider } from "./payment.provider";
import { markPaymentAuthorizedAndSchedule } from "../orders/orders.service";

type DbOrTx = NodePgDatabase<typeof schema>;

/**
 * Authorizes payment for an order (a "hold", not a charge yet — mirrors real
 * card auth-then-capture) and advances the order into the dispatch pipeline.
 * This is the piece the codebase previously only had a comment for:
 * `markPaymentAuthorizedAndSchedule`'s doc comment said "Called by the
 * payment service after Stripe confirms authorization" but nothing ever
 * called it through a real payment step — see README gap analysis.
 */
export async function authorizePayment(orderId: string, actorUserId: string) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order", orderId);
  if (order.status !== "AWAITING_PAYMENT") {
    throw new ValidationError(`Order must be AWAITING_PAYMENT to authorize payment, got ${order.status}`);
  }
  if (order.totalCents == null) throw new ValidationError("Order has no price to authorize");

  const existing = await db.query.payments.findFirst({ where: eq(schema.payments.orderId, orderId) });
  if (existing) throw new ConflictError("Payment already authorized for this order");

  const { providerRef, clientSecret } = await paymentProvider.authorize({
    amountCents: order.totalCents,
    currency: order.currency,
    customerRef: order.customerProfileId,
  });

  const [payment] = await db
    .insert(schema.payments)
    .values({
      orderId,
      stripePaymentIntentId: providerRef,
      amountCents: order.totalCents,
      status: "AUTHORIZED",
    })
    .returning();

  await recordAudit(db, {
    actorId: actorUserId,
    action: "PAYMENT_AUTHORIZED",
    entityType: "Payment",
    entityId: payment.id,
    after: { orderId, amountCents: payment.amountCents },
  });

  // Advances AWAITING_PAYMENT -> SCHEDULED -> SEARCHING_FOR_DRIVER.
  await markPaymentAuthorizedAndSchedule(orderId);

  // clientSecret is not persisted (Stripe client secrets are meant to be
  // used once, client-side, right after creation, not stored) — it's only
  // present when StripePaymentProvider is active (payment.provider.ts) and
  // is what a real client-side Stripe SDK integration would need to
  // complete card confirmation. MockPaymentProvider never sets it.
  return { ...payment, clientSecret };
}

async function totalRefundedCents(dbOrTx: DbOrTx, paymentId: string): Promise<number> {
  const refunds = await dbOrTx.query.refunds.findMany({ where: eq(schema.refunds.paymentId, paymentId) });
  return refunds.reduce((sum, r) => sum + r.amountCents, 0);
}

/**
 * Captures a payment for the *net* amount (original authorization minus any
 * discounts/refunds issued before capture — e.g. a grouped-route discount,
 * see batching.service.ts). Tolerates a missing payment (some orders may
 * have been advanced through the state machine directly in tests/dev
 * tooling, bypassing the real payment step) by returning null rather than
 * throwing, since capture is a side effect of delivery, not the main flow.
 */
export async function capturePaymentForOrder(tx: DbOrTx, orderId: string) {
  const payment = await tx.query.payments.findFirst({ where: eq(schema.payments.orderId, orderId) });
  if (!payment) return null;
  if (payment.status !== "AUTHORIZED") return payment;

  const netAmountCents = Math.max(0, payment.amountCents - (await totalRefundedCents(tx, payment.id)));
  await paymentProvider.capture(payment.stripePaymentIntentId ?? "", netAmountCents);

  const [updated] = await tx
    .update(schema.payments)
    .set({ status: "CAPTURED", capturedAt: new Date() })
    .where(eq(schema.payments.id, payment.id))
    .returning();

  await recordAudit(tx, {
    actorId: null,
    action: "PAYMENT_CAPTURED",
    entityType: "Payment",
    entityId: payment.id,
    after: { orderId, netAmountCents },
  });

  return updated;
}

/**
 * Issues a refund/discount against an order's payment. Works whether the
 * payment has been captured yet or not: pre-capture, this reduces the net
 * amount `capturePaymentForOrder` will actually charge (like adjusting a
 * card hold before settlement); post-capture, it's a real refund. Used both
 * for the grouped-route discount (batching.service.ts) and admin-issued
 * refunds (e.g. resolving a claim).
 */
export async function issueRefund(
  tx: DbOrTx,
  orderId: string,
  amountCents: number,
  reason: string,
  issuedBy: string
) {
  if (amountCents <= 0) throw new ValidationError("Refund amount must be positive");

  const payment = await tx.query.payments.findFirst({ where: eq(schema.payments.orderId, orderId) });
  if (!payment) throw new ValidationError("No payment exists for this order to refund");

  const alreadyRefunded = await totalRefundedCents(tx, payment.id);
  const cappedAmountCents = Math.min(amountCents, Math.max(0, payment.amountCents - alreadyRefunded));
  if (cappedAmountCents <= 0) return null; // already fully refunded/discounted — nothing left to give back

  const { providerRefundRef } = await paymentProvider.refund(payment.stripePaymentIntentId ?? "", cappedAmountCents);

  const [refund] = await tx
    .insert(schema.refunds)
    .values({ paymentId: payment.id, amountCents: cappedAmountCents, reason, issuedBy, providerRefundRef })
    .returning();

  const newTotalRefunded = alreadyRefunded + cappedAmountCents;
  if (payment.status === "CAPTURED" || payment.status === "PARTIALLY_REFUNDED") {
    const newStatus = newTotalRefunded >= payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await tx.update(schema.payments).set({ status: newStatus }).where(eq(schema.payments.id, payment.id));
  }

  await recordAudit(tx, {
    // Pseudo-actors ("system:...", "driver:...") are normalized to a null
    // actor inside recordAudit itself — the reason/issuedBy is still
    // captured below in `after`.
    actorId: issuedBy,
    action: "REFUND_ISSUED",
    entityType: "Payment",
    entityId: payment.id,
    after: { orderId, amountCents: cappedAmountCents, reason, issuedBy },
  });

  return refund;
}

export async function listPayments(status?: string) {
  return db.query.payments.findMany({
    where: status ? eq(schema.payments.status, status as any) : undefined,
    orderBy: (payments, { desc }) => [desc(payments.createdAt)],
    with: { refunds: true },
  });
}
