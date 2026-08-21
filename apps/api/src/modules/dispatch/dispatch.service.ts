import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db, schema } from "../../db";
import { env } from "../../env";
import { NotFoundError, ValidationError, ConflictError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { OrderStatus } from "@courier/shared-types";
import { transitionOrder } from "../orders/orders.service";
import { getRouteBatch } from "./batching.service";

type DbOrTx = NodePgDatabase<typeof schema>;

/**
 * Resolves who actually ended up carrying an order — whether it was offered
 * (and accepted) individually or as part of a route batch — and at what
 * payout. Shared by payment capture (driver earnings), live tracking (who to
 * show as "your driver"), and the payout run, so all three agree on exactly
 * one source of truth instead of re-deriving it three different ways.
 */
export async function getAcceptedOfferForOrder(
  dbOrTx: DbOrTx,
  orderId: string
): Promise<{ driverId: string; payoutCents: number; routeBatchId: string | null } | null> {
  const direct = await dbOrTx.query.driverOffers.findFirst({
    where: and(eq(schema.driverOffers.orderId, orderId), eq(schema.driverOffers.status, "ACCEPTED")),
  });
  if (direct) return { driverId: direct.driverId, payoutCents: direct.payoutCents, routeBatchId: null };

  const assignment = await dbOrTx.query.routeAssignments.findFirst({ where: eq(schema.routeAssignments.orderId, orderId) });
  if (!assignment) return null;

  const batchOffer = await dbOrTx.query.driverOffers.findFirst({
    where: and(eq(schema.driverOffers.routeBatchId, assignment.routeBatchId), eq(schema.driverOffers.status, "ACCEPTED")),
  });
  if (!batchOffer) return null;

  return { driverId: batchOffer.driverId, payoutCents: batchOffer.payoutCents, routeBatchId: assignment.routeBatchId };
}

/**
 * Candidate matching (simplified).
 *
 * The full algorithm in 02-architecture.md §8 scores candidates on distance,
 * ETA, grouping opportunity, driver reliability, and payout/margin. This
 * implementation does the part that matters most for correctness — filtering
 * to online, approved, capacity-available drivers — and ranks the rest by
 * rating only. Swap `findCandidateDrivers` for the full scoring model when
 * you have real GPS/ETA data flowing through `location_events`.
 */
async function findCandidateDrivers(limit = 5) {
  return db.query.drivers.findMany({
    where: and(eq(schema.drivers.status, "APPROVED"), eq(schema.drivers.onlineStatus, true), lt(schema.drivers.activeOrderCount, 3)),
    orderBy: [desc(schema.drivers.ratingAvg)],
    limit,
  });
}

/**
 * Offers an entire APPROVED route batch to the top-ranked candidate driver as
 * a single offer (`driver_offers.route_batch_id` set, `.order_id` left null —
 * the seam `acceptOffer` below already expected, see its routeBatchId branch).
 */
export async function createBatchOfferRound(routeBatchId: string, payoutCents: number) {
  const batch = await db.query.routeBatches.findFirst({
    where: eq(schema.routeBatches.id, routeBatchId),
    with: { assignments: true },
  });
  if (!batch) throw new NotFoundError("RouteBatch", routeBatchId);
  if (batch.status !== "APPROVED") {
    throw new ValidationError(`Route batch must be APPROVED to offer it, got ${batch.status}`);
  }

  const candidates = await findCandidateDrivers();
  if (candidates.length === 0) {
    throw new ConflictError("No available drivers found — batch remains APPROVED, unoffered");
  }

  // Atomic claim, same pattern as acceptOffer's conditional UPDATE: only
  // proceed if the batch is still APPROVED at the moment of the write. Found
  // missing by a code review pass — previously the batch's status never
  // advanced off APPROVED after a successful offer, so the admin UI's
  // "Offer to top driver" button stayed live and a second click created a
  // duplicate offer, then threw mid-loop (orders already DRIVER_OFFERED
  // aren't a valid DRIVER_OFFERED->DRIVER_OFFERED transition) leaving an
  // orphaned extra driver_offers row. This also closes a genuine race
  // between two concurrent "offer this batch" clicks.
  const claimed = await db
    .update(schema.routeBatches)
    .set({ status: "OFFERED" })
    .where(and(eq(schema.routeBatches.id, routeBatchId), eq(schema.routeBatches.status, "APPROVED")))
    .returning();
  if (claimed.length === 0) {
    throw new ConflictError("This batch is no longer APPROVED — it may have just been offered by someone else");
  }

  const expiresAt = new Date(Date.now() + env.OFFER_TIMEOUT_SECONDS * 1000);
  const topCandidate = candidates[0];

  const [offer] = await db
    .insert(schema.driverOffers)
    .values({ routeBatchId, driverId: topCandidate.id, payoutCents, expiresAt, status: "PENDING" })
    .returning();

  for (const assignment of batch.assignments) {
    await transitionOrder(assignment.orderId, OrderStatus.DRIVER_OFFERED, "system:dispatch", {
      offerId: offer.id,
      routeBatchId,
    });
  }

  return offer;
}

export async function createOfferRound(orderId: string, payoutCents: number) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order", orderId);
  if (order.status !== "SEARCHING_FOR_DRIVER") {
    throw new ValidationError(`Order must be SEARCHING_FOR_DRIVER to offer it, got ${order.status}`);
  }

  // Found by review: an order can be SEARCHING_FOR_DRIVER while already
  // committed to a SUGGESTED/APPROVED route batch (batching.service.ts
  // never changes order status when it groups orders) — offering it
  // individually here as well let it end up with two competing offers, and
  // batch-offering it later threw mid-loop on the already-DRIVER_OFFERED
  // order, leaving the batch stuck OFFERED with a live orphaned offer.
  const existingAssignment = await db.query.routeAssignments.findFirst({
    where: eq(schema.routeAssignments.orderId, orderId),
  });
  if (existingAssignment) {
    throw new ConflictError(
      "This order is part of a route batch — offer the batch instead of the order individually"
    );
  }

  const candidates = await findCandidateDrivers();
  if (candidates.length === 0) {
    throw new ConflictError("No available drivers found — order remains in SEARCHING_FOR_DRIVER");
  }

  const expiresAt = new Date(Date.now() + env.OFFER_TIMEOUT_SECONDS * 1000);

  // MVP: offer to the single top-ranked candidate. The full design in the
  // architecture spec offers to multiple simultaneous candidates in
  // low-density zones with first-accept-wins; that requires the same atomic
  // accept logic below, just seeded with more than one PENDING row.
  const topCandidate = candidates[0];

  const [offer] = await db
    .insert(schema.driverOffers)
    .values({ orderId, driverId: topCandidate.id, payoutCents, expiresAt, status: "PENDING" })
    .returning();

  await transitionOrder(orderId, OrderStatus.DRIVER_OFFERED, "system:dispatch", { offerId: offer.id });

  return offer;
}

/**
 * Atomic offer acceptance — THE critical concurrency-safety guarantee in the
 * whole system (01-product-specification.md §7, §11 acceptance criteria: "0
 * instances of duplicate offer acceptance").
 *
 * Approach: a single conditional UPDATE ... WHERE status = 'PENDING' is
 * atomic in Postgres — if two requests race, only one UPDATE can match the
 * row while it's still PENDING; the loser's update returns zero affected
 * rows. No application-level locking or Redis needed for correctness here
 * (Redis-backed locking in the architecture doc is an optimization for
 * avoiding wasted work at high contention, not a correctness requirement —
 * the DB row is always the source of truth). This is verified directly by
 * the concurrency test in tests/dispatch.concurrency.test.ts.
 */
export async function acceptOffer(offerId: string, driverId: string) {
  const { offer, orderIds } = await db.transaction(async (tx) => {
    const existing = await tx.query.driverOffers.findFirst({ where: eq(schema.driverOffers.id, offerId) });
    if (!existing) throw new NotFoundError("DriverOffer", offerId);
    if (existing.driverId !== driverId) {
      throw new ValidationError("This offer was not made to this driver");
    }
    if (existing.expiresAt < new Date()) {
      throw new ConflictError("This offer has expired");
    }

    const updated = await tx
      .update(schema.driverOffers)
      .set({ status: "ACCEPTED" })
      .where(and(eq(schema.driverOffers.id, offerId), eq(schema.driverOffers.status, "PENDING")))
      .returning();

    if (updated.length === 0) {
      // Someone else already accepted/declined this offer, or it expired
      // between our read above and the update — the atomic predicate caught it.
      throw new ConflictError("This offer is no longer available (already accepted, declined, or expired)");
    }

    // A batch offer covers N orders at once (route_batch_id set, order_id
    // null — see createBatchOfferRound); a regular offer covers exactly one.
    let orderIds: string[];
    if (existing.orderId) {
      orderIds = [existing.orderId];
    } else if (existing.routeBatchId) {
      const assignments = await tx.query.routeAssignments.findMany({
        where: eq(schema.routeAssignments.routeBatchId, existing.routeBatchId),
      });
      orderIds = assignments.map((a) => a.orderId);

      await tx
        .update(schema.routeBatches)
        .set({ driverId, status: "ASSIGNED" })
        .where(eq(schema.routeBatches.id, existing.routeBatchId));
    } else {
      throw new ValidationError("Offer references neither an order nor a route batch");
    }

    // Atomic increment (SET x = x + N at the DB level) — reading the current
    // count in application code and writing count+N back would itself be a
    // race under concurrent accepts for different orders/batches by the same driver.
    await tx
      .update(schema.drivers)
      .set({ activeOrderCount: sql`${schema.drivers.activeOrderCount} + ${orderIds.length}` })
      .where(eq(schema.drivers.id, driverId));

    await recordAudit(tx, {
      actorId: null,
      action: "DRIVER_OFFER_ACCEPTED",
      entityType: "DriverOffer",
      entityId: offerId,
      after: { driverId, orderIds, routeBatchId: existing.routeBatchId },
    });

    return { offer: updated[0], orderIds };
  });

  // Transitions happen outside the offer-accept transaction intentionally —
  // each has its own transaction via transitionOrder(), and if one fails we
  // don't want to have rolled back the (already-correct) offer acceptance.
  // A production system would instead make this whole flow a single saga
  // with compensating actions; flagged here rather than silently glossed over.
  for (const orderId of orderIds) {
    await transitionOrder(orderId, OrderStatus.DRIVER_ASSIGNED, "system:dispatch", { driverId });
  }
  return offer;
}

/**
 * Puts every DRIVER_OFFERED order among `orderIds` back into
 * SEARCHING_FOR_DRIVER (a no-op for any order already elsewhere in the
 * pipeline). Shared by declineOffer's batch branch and
 * offerExpirySweep.job.ts — both used to do this with a separate
 * `orders.findFirst` per order in a loop; this batches that read into one
 * `inArray` query instead (the actual transitionOrder calls still happen
 * one per order, since each needs its own state-machine validation and
 * audit row).
 */
export async function releaseOrdersToSearching(orderIds: string[], actorId: string, meta: Record<string, unknown>) {
  if (orderIds.length === 0) return;
  const orders = await db.query.orders.findMany({ where: inArray(schema.orders.id, orderIds) });
  for (const order of orders) {
    if (order.status === "DRIVER_OFFERED") {
      await transitionOrder(order.id, OrderStatus.SEARCHING_FOR_DRIVER, actorId, meta);
    }
  }
}

export async function declineOffer(offerId: string, driverId: string) {
  const updated = await db
    .update(schema.driverOffers)
    .set({ status: "DECLINED" })
    .where(and(eq(schema.driverOffers.id, offerId), eq(schema.driverOffers.driverId, driverId), eq(schema.driverOffers.status, "PENDING")))
    .returning();

  if (updated.length === 0) {
    throw new ConflictError("Offer already resolved or does not belong to this driver");
  }
  const offer = updated[0];

  // Puts the order(s) — and, for a batch offer, the batch itself — back in a
  // re-offerable state. Found missing by a code review pass: previously a
  // decline never touched order/batch status at all, and since the offer
  // expiry sweep only matches status='PENDING' offers, a DECLINED offer
  // (not PENDING) was never picked up either — the order (or whole batch)
  // was permanently orphaned in DRIVER_OFFERED/OFFERED with no way back into
  // the dispatch pool short of manual intervention.
  if (offer.orderId) {
    await releaseOrdersToSearching([offer.orderId], "system:dispatch", { declinedOfferId: offer.id });
  } else if (offer.routeBatchId) {
    const assignments = await db.query.routeAssignments.findMany({
      where: eq(schema.routeAssignments.routeBatchId, offer.routeBatchId),
    });
    await releaseOrdersToSearching(
      assignments.map((a) => a.orderId),
      "system:dispatch",
      { declinedOfferId: offer.id }
    );
    await db.update(schema.routeBatches).set({ status: "APPROVED" }).where(eq(schema.routeBatches.id, offer.routeBatchId));
  }

  // Re-entering the offer pool (creating the *next* offer round) is left to
  // a background job in the full design (§7 Event & Job Architecture) — not
  // triggered synchronously here to keep this endpoint fast.
  return { declined: true };
}

export async function setDriverOnlineStatus(driverId: string, online: boolean) {
  const [driver] = await db.update(schema.drivers).set({ onlineStatus: online }).where(eq(schema.drivers.id, driverId)).returning();
  return driver;
}

export async function listPendingOffersForDriver(driverId: string) {
  const offers = await db.query.driverOffers.findMany({
    where: and(eq(schema.driverOffers.driverId, driverId), eq(schema.driverOffers.status, "PENDING")),
    orderBy: (offers, { desc }) => [desc(offers.createdAt)],
  });

  // Expired-but-still-PENDING offers can exist if the expiry sweep job hasn't
  // run yet (that background job isn't implemented in this starter kit — see
  // 02-architecture.md §7). Filter them out here so the driver app never
  // shows an offer it can't actually accept.
  const now = new Date();
  const stillValid = offers.filter((o) => o.expiresAt > now);

  // Hydrate with order + stop details (or, for a batch offer, every order in
  // the batch, sequenced) so the driver app has enough to render the offer
  // card without a second round-trip per offer.
  const withOrders = await Promise.all(
    stillValid.map(async (offer) => {
      if (offer.orderId) {
        const order = await db.query.orders.findFirst({
          where: eq(schema.orders.id, offer.orderId),
          with: { packages: true, stops: { with: { address: true } } },
        });
        return { ...offer, order, routeBatch: null };
      }
      if (offer.routeBatchId) {
        const routeBatch = await getRouteBatch(offer.routeBatchId);
        return { ...offer, order: null, routeBatch };
      }
      return { ...offer, order: null, routeBatch: null };
    })
  );

  return withOrders;
}
