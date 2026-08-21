import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { ForbiddenError, NotFoundError, ValidationError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { getAcceptedOfferForOrder } from "../dispatch/dispatch.service";
import { issueRefund } from "../payments/payments.service";
import { transitionOrderThrough } from "../orders/orders.service";
import { OrderStatus } from "@courier/shared-types";

const CLAIM_TYPES = ["DAMAGED", "LOST", "LATE", "WRONG_ITEM", "BILLING", "OTHER"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/** Closes the admin "exceptions" gap: claims_disputes existed in the schema with zero service logic. */
export async function createClaim(input: {
  orderId: string;
  actorUserId: string;
  actorDriverId?: string;
  actorCustomerProfileId?: string;
  type: ClaimType;
  description: string;
  evidenceRefs?: string[];
}) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, input.orderId) });
  if (!order) throw new NotFoundError("Order", input.orderId);

  // Object-level check: only the customer who placed the order or the driver
  // who carried it may file a claim about it (admins bypass this via the
  // route layer — see claims.routes.ts).
  if (input.actorCustomerProfileId && order.customerProfileId !== input.actorCustomerProfileId) {
    throw new ForbiddenError("You do not have access to this order");
  }
  if (input.actorDriverId) {
    const accepted = await getAcceptedOfferForOrder(db, input.orderId);
    if (!accepted || accepted.driverId !== input.actorDriverId) {
      throw new ForbiddenError("You are not the assigned driver for this order");
    }
  }

  const [claim] = await db
    .insert(schema.claimsDisputes)
    .values({
      orderId: input.orderId,
      reportedByUserId: input.actorUserId,
      type: input.type,
      description: input.description,
      evidenceRefs: input.evidenceRefs ?? [],
      status: "OPEN",
    })
    .returning();

  await recordAudit(db, {
    actorId: input.actorUserId,
    action: "CLAIM_CREATED",
    entityType: "ClaimsDispute",
    entityId: claim.id,
    after: { orderId: input.orderId, type: input.type },
  });

  return claim;
}

export async function listClaimsForOrder(orderId: string) {
  return db.query.claimsDisputes.findMany({
    where: eq(schema.claimsDisputes.orderId, orderId),
    orderBy: (claims, { desc }) => [desc(claims.createdAt)],
  });
}

export async function listClaims(status?: string) {
  return db.query.claimsDisputes.findMany({
    where: status ? eq(schema.claimsDisputes.status, status) : undefined,
    orderBy: (claims, { desc }) => [desc(claims.createdAt)],
  });
}

export async function getClaim(id: string) {
  const claim = await db.query.claimsDisputes.findFirst({ where: eq(schema.claimsDisputes.id, id) });
  if (!claim) throw new NotFoundError("ClaimsDispute", id);
  return claim;
}

/**
 * Resolves a claim. `refundCents` is optional — a dispatcher upholding a
 * DAMAGED/LOST claim can issue a real refund against the order's payment in
 * the same action, using the same refund machinery the grouped-route
 * discount uses (payments.service.ts's issueRefund).
 */
export async function resolveClaim(
  id: string,
  actorUserId: string,
  outcome: "RESOLVED" | "REJECTED",
  resolution: string,
  refundCents?: number
) {
  return db.transaction(async (tx) => {
    const claim = await tx.query.claimsDisputes.findFirst({ where: eq(schema.claimsDisputes.id, id) });
    if (!claim) throw new NotFoundError("ClaimsDispute", id);
    if (claim.status !== "OPEN") {
      throw new ValidationError(`Claim must be OPEN to resolve, got ${claim.status}`);
    }

    if (refundCents && refundCents > 0) {
      if (outcome !== "RESOLVED") throw new ValidationError("Refunds may only be issued when upholding (RESOLVED) a claim");
      await issueRefund(tx, claim.orderId, refundCents, `Claim resolution: ${resolution}`, actorUserId);
      // ORDER_STATUS_TRANSITIONS models DELIVERED -> DISPUTED -> REFUNDED
      // for exactly this case — found by review to be unused: resolving a
      // claim with a refund moved the payment to REFUNDED but left the
      // order's own status at DELIVERED forever, so any report/KPI that
      // sums totalCents for status=DELIVERED orders silently counted
      // fully-refunded revenue as real. Only done when an actual refund is
      // issued — REJECTED or a no-refund RESOLVED claim leaves the order's
      // status alone, since DISPUTED/REFUNDED has no path back to DELIVERED.
      await transitionOrderThrough(claim.orderId, OrderStatus.REFUNDED, actorUserId, { claimId: id, refundCents }, tx);
    }

    const [updated] = await tx
      .update(schema.claimsDisputes)
      .set({ status: outcome, resolution, resolvedBy: actorUserId })
      .where(eq(schema.claimsDisputes.id, id))
      .returning();

    await recordAudit(tx, {
      actorId: actorUserId,
      action: `CLAIM_${outcome}`,
      entityType: "ClaimsDispute",
      entityId: id,
      after: { resolution, refundCents: refundCents ?? 0 },
    });

    return updated;
  });
}
