import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "../db";
import { transitionOrder } from "../modules/orders/orders.service";
import { OrderStatus } from "@courier/shared-types";

/**
 * Offer-expiry sweep (02-architecture.md §7). Previously nothing implemented
 * this — an offer past its `expiresAt` just sat there as PENDING forever
 * (dispatch.service.ts's `listPendingOffersForDriver` filtered it out of the
 * driver's view, but the order stayed stuck in DRIVER_OFFERED with no way
 * back into the dispatch pool). This finds every expired-but-still-PENDING
 * offer, marks it EXPIRED, and — for each order it covered — puts the order
 * back in SEARCHING_FOR_DRIVER so the next dispatch/batch round can pick it
 * back up. Uses the same atomic conditional-UPDATE pattern as
 * dispatch.service.ts's acceptOffer to stay race-safe against a driver
 * accepting the instant before the sweep runs.
 */
export async function runOfferExpirySweep() {
  const now = new Date();
  const candidates = await db.query.driverOffers.findMany({
    where: and(eq(schema.driverOffers.status, "PENDING"), lt(schema.driverOffers.expiresAt, now)),
  });

  let sweptCount = 0;
  for (const offer of candidates) {
    const updated = await db
      .update(schema.driverOffers)
      .set({ status: "EXPIRED" })
      .where(and(eq(schema.driverOffers.id, offer.id), eq(schema.driverOffers.status, "PENDING")))
      .returning();
    if (updated.length === 0) continue; // raced with an accept/decline between the query above and this update

    const orderIds = offer.orderId
      ? [offer.orderId]
      : offer.routeBatchId
        ? (
            await db.query.routeAssignments.findMany({ where: eq(schema.routeAssignments.routeBatchId, offer.routeBatchId) })
          ).map((a) => a.orderId)
        : [];

    for (const orderId of orderIds) {
      const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
      if (order?.status === "DRIVER_OFFERED") {
        await transitionOrder(orderId, OrderStatus.SEARCHING_FOR_DRIVER, "system:offer-expiry-sweep", {
          expiredOfferId: offer.id,
        });
      }
    }

    // A batch offer also claims the batch itself (status: OFFERED, see
    // dispatch.service.ts's createBatchOfferRound) — release it back to
    // APPROVED so it's eligible to be re-offered, same reasoning as
    // declineOffer's batch-revert branch.
    if (offer.routeBatchId) {
      const batch = await db.query.routeBatches.findFirst({ where: eq(schema.routeBatches.id, offer.routeBatchId) });
      if (batch?.status === "OFFERED") {
        await db.update(schema.routeBatches).set({ status: "APPROVED" }).where(eq(schema.routeBatches.id, offer.routeBatchId));
      }
    }

    sweptCount++;
  }

  return { sweptCount };
}
