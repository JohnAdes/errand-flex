import { and, eq, notInArray } from "drizzle-orm";
import { db, schema } from "../../db";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";
import { estimateDistanceKm } from "../pricing/pricing.service";
import { issueRefund } from "../payments/payments.service";
import type { ServiceLevel } from "@courier/shared-types";

/**
 * Route-grouping / batching algorithm (02-architecture.md §9), scoped down
 * for this starter kit: no H3 indexing (no real geo-index library wired up)
 * and no mapping-provider distance matrix (same placeholder-distance
 * limitation as pricing.service.ts's `estimateDistanceKm` — straight-line +
 * fudge factor, not real road routing). What IS real: candidate generation
 * from live un-batched orders, proximity + capacity + compatibility
 * filtering, nearest-neighbor route sequencing, and a detour-ratio rejection
 * threshold — the actual decision logic, just fed simplified distances.
 *
 * Schema note: `route_assignments.order_id` and `.stop_id` are both UNIQUE,
 * so this starter kit's schema models one assignment row per *order* per
 * batch (not one per stop) — there's no way to persist a full
 * pickup-then-dropoff stop sequence per order without a schema change. This
 * implementation sequences and persists the PICKUP-side route (the leg a
 * driver actually needs turn-by-turn order for before any packages are in
 * hand) and uses the full pickup+dropoff route length only in memory, to
 * score/reject a grouping's detour cost before persisting it.
 */

/**
 * Batching's tuning knobs, grouped into one exported object — unlike
 * pricing.service.ts's rule set (DB-backed, admin-editable, versioned via
 * `pricing_rule_versions`), these are still hardcoded: any operational
 * tuning here needs a code deploy, not an admin-panel edit, and there's no
 * audited change history. Promoting this to a real DB-backed/admin-editable
 * rule set (mirroring pricing's pattern) would be a substantial follow-up
 * feature, not a cleanup — centralizing the constants here at least makes
 * them one discoverable place to find and reason about together.
 */
export const BATCHING_CONFIG = {
  PICKUP_CLUSTER_RADIUS_KM: 3,
  DROPOFF_CLUSTER_RADIUS_KM: 6,
  MAX_BATCH_SIZE: 4,
  // Conservative vs. a sedan's ~200kg capacity (see seed.ts), leaves buffer
  // for the driver's own cargo handling.
  MAX_COMBINED_WEIGHT_KG: 150,
  // Batched route length vs. sum of each order's direct pickup->dropoff distance.
  MAX_DETOUR_RATIO: 1.6,
  // Closes the "grouped routes lower customer prices" pricing-doc claim,
  // which wasn't actually wired to anything: a quote is priced and locked
  // before dispatch ever runs, so there's no way to know at quote time
  // whether an order will end up grouped. Instead of changing an
  // already-charged price (which would break the "quotes never change
  // retroactively" guarantee — see pricing.service.ts), a successful
  // grouping issues a discount/refund against the order's payment, sized as
  // a share of the detour savings the grouping actually produced.
  GROUP_DISCOUNT_SAVINGS_SHARE: 0.3, // fraction of the detour-ratio savings passed to the customer
  MAX_GROUP_DISCOUNT_RATE: 0.15, // cap so a very tight grouping can't wipe out platform margin
  // PRIORITY/SCHEDULED orders carry tighter time promises than an MVP
  // proximity-only grouping can safely honor without real time-window/ETA
  // modeling — only group the service levels where a modest shared-route
  // delay is an acceptable tradeoff.
  GROUPABLE_SERVICE_LEVELS: ["ECONOMY", "STANDARD"] as ServiceLevel[],
};

interface Candidate {
  orderId: string;
  totalCents: number;
  weightKg: number;
  pickup: { lat: number; lng: number; stopId: string };
  dropoff: { lat: number; lng: number };
  directDistanceKm: number;
  createdAt: Date;
}

async function getGroupableCandidates(): Promise<Candidate[]> {
  const alreadyAssigned = await db.select({ orderId: schema.routeAssignments.orderId }).from(schema.routeAssignments);
  const alreadyOffered = await db
    .select({ orderId: schema.driverOffers.orderId })
    .from(schema.driverOffers)
    .where(and(eq(schema.driverOffers.status, "PENDING")));

  const excludeIds = [
    ...alreadyAssigned.map((r) => r.orderId),
    ...alreadyOffered.map((r) => r.orderId).filter((id): id is string => id !== null),
  ];

  const orders = await db.query.orders.findMany({
    where: and(
      eq(schema.orders.status, "SEARCHING_FOR_DRIVER"),
      excludeIds.length > 0 ? notInArray(schema.orders.id, excludeIds) : undefined
    ),
    with: { packages: true, stops: { with: { address: true } } },
  });

  const candidates: Candidate[] = [];
  for (const order of orders) {
    if (!BATCHING_CONFIG.GROUPABLE_SERVICE_LEVELS.includes(order.serviceLevel as ServiceLevel)) continue;
    if (order.packages.some((p) => p.confidential)) continue; // exclusivity flag — never grouped

    const pickupStop = order.stops.find((s) => s.type === "PICKUP");
    const dropoffStop = order.stops.find((s) => s.type === "DROPOFF");
    if (!pickupStop || !dropoffStop) continue;

    const weightKg = order.packages.reduce((sum, p) => sum + p.weightKg * p.quantity, 0);
    const pickup = { lat: pickupStop.address.lat, lng: pickupStop.address.lng, stopId: pickupStop.id };
    const dropoff = { lat: dropoffStop.address.lat, lng: dropoffStop.address.lng };

    candidates.push({
      orderId: order.id,
      totalCents: order.totalCents ?? 0,
      weightKg,
      pickup,
      dropoff,
      directDistanceKm: estimateDistanceKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng),
      createdAt: order.createdAt,
    });
  }

  return candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Greedy clustering: walk candidates oldest-first, join the first cluster that still fits, else start a new one. */
function clusterCandidates(candidates: Candidate[]): Candidate[][] {
  const clusters: Candidate[][] = [];

  for (const candidate of candidates) {
    const cluster = clusters.find((cl) => {
      if (cl.length >= BATCHING_CONFIG.MAX_BATCH_SIZE) return false;
      const combinedWeight = cl.reduce((sum, m) => sum + m.weightKg, 0) + candidate.weightKg;
      if (combinedWeight > BATCHING_CONFIG.MAX_COMBINED_WEIGHT_KG) return false;
      return cl.every((m) => {
        const pickupKm = estimateDistanceKm(m.pickup.lat, m.pickup.lng, candidate.pickup.lat, candidate.pickup.lng);
        const dropoffKm = estimateDistanceKm(m.dropoff.lat, m.dropoff.lng, candidate.dropoff.lat, candidate.dropoff.lng);
        return pickupKm <= BATCHING_CONFIG.PICKUP_CLUSTER_RADIUS_KM && dropoffKm <= BATCHING_CONFIG.DROPOFF_CLUSTER_RADIUS_KM;
      });
    });

    if (cluster) cluster.push(candidate);
    else clusters.push([candidate]);
  }

  return clusters;
}

/** Nearest-neighbor sequencing of a cluster's pickups, then its dropoffs, for detour scoring + persistence. */
function sequenceRoute(cluster: Candidate[]) {
  const remainingPickups = [...cluster];
  const orderedPickups: Candidate[] = [];
  let current = remainingPickups.shift()!;
  orderedPickups.push(current);
  let pickupLegKm = 0;
  while (remainingPickups.length > 0) {
    remainingPickups.sort(
      (a, b) =>
        estimateDistanceKm(current.pickup.lat, current.pickup.lng, a.pickup.lat, a.pickup.lng) -
        estimateDistanceKm(current.pickup.lat, current.pickup.lng, b.pickup.lat, b.pickup.lng)
    );
    const next = remainingPickups.shift()!;
    pickupLegKm += estimateDistanceKm(current.pickup.lat, current.pickup.lng, next.pickup.lat, next.pickup.lng);
    orderedPickups.push(next);
    current = next;
  }

  let dropoffPoint: { lat: number; lng: number } = orderedPickups[orderedPickups.length - 1].pickup;
  const remainingDropoffs = [...cluster];
  let dropoffLegKm = 0;
  while (remainingDropoffs.length > 0) {
    remainingDropoffs.sort(
      (a, b) =>
        estimateDistanceKm(dropoffPoint.lat, dropoffPoint.lng, a.dropoff.lat, a.dropoff.lng) -
        estimateDistanceKm(dropoffPoint.lat, dropoffPoint.lng, b.dropoff.lat, b.dropoff.lng)
    );
    const next = remainingDropoffs.shift()!;
    dropoffLegKm += estimateDistanceKm(dropoffPoint.lat, dropoffPoint.lng, next.dropoff.lat, next.dropoff.lng);
    dropoffPoint = next.dropoff;
  }

  const batchedRouteKm = pickupLegKm + dropoffLegKm;
  const sumDirectKm = cluster.reduce((sum, c) => sum + c.directDistanceKm, 0);
  const detourRatio = sumDirectKm > 0 ? batchedRouteKm / sumDirectKm : Infinity;

  return { orderedPickups, batchedRouteKm, sumDirectKm, detourRatio };
}

/**
 * Runs candidate generation + clustering + scoring and persists every
 * cluster that clears the detour threshold as a `SUGGESTED` route_batch.
 * Normally triggered by a background job on a timer (02-architecture.md §7);
 * exposed as an admin/internal endpoint here for the same reason the
 * single-order offer round is (see dispatch.routes.ts) — no job queue wired
 * up in this starter kit.
 */
export async function suggestRouteBatches() {
  const candidates = await getGroupableCandidates();
  const clusters = clusterCandidates(candidates).filter((cl) => cl.length >= 2);

  const created = [];
  for (const cluster of clusters) {
    const { orderedPickups, batchedRouteKm, sumDirectKm, detourRatio } = sequenceRoute(cluster);
    if (detourRatio > BATCHING_CONFIG.MAX_DETOUR_RATIO) continue;

    const savingsFraction = Math.max(0, Math.min(1, 1 - detourRatio));
    const discountRate = Math.min(BATCHING_CONFIG.MAX_GROUP_DISCOUNT_RATE, savingsFraction * BATCHING_CONFIG.GROUP_DISCOUNT_SAVINGS_SHARE);

    const batch = await db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(schema.routeBatches)
        .values({
          status: "SUGGESTED",
          createdBy: "SYSTEM",
          groupingReason: {
            factors: ["pickup_proximity", "dropoff_proximity", "weight_capacity", "service_level_compatibility"],
            pickupClusterRadiusKm: BATCHING_CONFIG.PICKUP_CLUSTER_RADIUS_KM,
            dropoffClusterRadiusKm: BATCHING_CONFIG.DROPOFF_CLUSTER_RADIUS_KM,
            maxDetourRatio: BATCHING_CONFIG.MAX_DETOUR_RATIO,
            detourRatio,
            batchedRouteKm: Math.round(batchedRouteKm * 10) / 10,
            sumDirectKm: Math.round(sumDirectKm * 10) / 10,
            orderIds: cluster.map((c) => c.orderId),
            groupDiscountRate: Math.round(discountRate * 1000) / 10, // percent, one decimal
          },
        })
        .returning();

      for (let i = 0; i < orderedPickups.length; i++) {
        const c = orderedPickups[i];
        await tx.insert(schema.routeAssignments).values({
          routeBatchId: batch.id,
          stopId: c.pickup.stopId,
          orderId: c.orderId,
          sequenceNo: i + 1,
        });
      }

      if (discountRate > 0) {
        for (const c of cluster) {
          const discountCents = Math.round(c.totalCents * discountRate);
          if (discountCents <= 0) continue;
          // Tolerates orders with no payment yet (e.g. advanced through the
          // state machine via dev tooling that bypasses the real payment
          // step) — grouping discounts are a bonus on top of a real payment,
          // not a blocker for the grouping itself.
          const existingPayment = await tx.query.payments.findFirst({ where: eq(schema.payments.orderId, c.orderId) });
          if (!existingPayment) continue;
          await issueRefund(tx, c.orderId, discountCents, "Grouped-route discount", "system:batching");
        }
      }

      await recordAudit(tx, {
        actorId: null,
        action: "ROUTE_BATCH_SUGGESTED",
        entityType: "RouteBatch",
        entityId: batch.id,
        after: { orderIds: cluster.map((c) => c.orderId), detourRatio, discountRate },
      });

      return batch;
    });

    created.push(batch);
  }

  return created;
}

export async function listRouteBatches(status?: string) {
  return db.query.routeBatches.findMany({
    where: status ? eq(schema.routeBatches.status, status) : undefined,
    orderBy: (batches, { desc }) => [desc(batches.createdAt)],
    with: { assignments: { with: { order: { with: { packages: true, stops: { with: { address: true } } } } } } },
  });
}

export async function getRouteBatch(id: string) {
  const batch = await db.query.routeBatches.findFirst({
    where: eq(schema.routeBatches.id, id),
    with: { assignments: { with: { order: { with: { packages: true, stops: { with: { address: true } } } } } } },
  });
  if (!batch) throw new NotFoundError("RouteBatch", id);
  return batch;
}

/** Dispatcher review step (02-architecture.md §9: "auto-approve only below a configurable risk/complexity threshold, else require dispatcher approval" — this starter kit always requires approval; no complexity scoring implemented yet). */
export async function approveRouteBatch(id: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const batch = await tx.query.routeBatches.findFirst({ where: eq(schema.routeBatches.id, id) });
    if (!batch) throw new NotFoundError("RouteBatch", id);
    if (batch.status !== "SUGGESTED") {
      throw new ValidationError(`Batch must be SUGGESTED to approve, got ${batch.status}`);
    }

    const [updated] = await tx
      .update(schema.routeBatches)
      .set({ status: "APPROVED" })
      .where(eq(schema.routeBatches.id, id))
      .returning();

    await recordAudit(tx, {
      actorId: actorUserId,
      action: "ROUTE_BATCH_APPROVED",
      entityType: "RouteBatch",
      entityId: id,
    });

    return updated;
  });
}

export async function rejectRouteBatch(id: string, actorUserId: string) {
  return db.transaction(async (tx) => {
    const batch = await tx.query.routeBatches.findFirst({ where: eq(schema.routeBatches.id, id) });
    if (!batch) throw new NotFoundError("RouteBatch", id);
    if (batch.status !== "SUGGESTED") {
      throw new ValidationError(`Batch must be SUGGESTED to reject, got ${batch.status}`);
    }

    // Free up the assignments so a future suggestion run can reconsider these
    // orders in a different grouping — the batch row itself stays as a
    // REJECTED audit trail rather than being deleted.
    await tx.delete(schema.routeAssignments).where(eq(schema.routeAssignments.routeBatchId, id));
    const [updated] = await tx
      .update(schema.routeBatches)
      .set({ status: "REJECTED" })
      .where(eq(schema.routeBatches.id, id))
      .returning();

    await recordAudit(tx, { actorId: actorUserId, action: "ROUTE_BATCH_REJECTED", entityType: "RouteBatch", entityId: id });

    return updated;
  });
}
