import { and, eq, lte } from "drizzle-orm";
import { db, schema } from "../../db";
import { ConflictError, NotFoundError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";

/**
 * Batches a driver's PENDING earnings (created per-delivery in
 * custody.service.ts) into one PAID payout, mirroring the "payout batch run"
 * job described in 02-architecture.md §7. Callable both from the admin
 * one-off endpoint (a real admin's UUID as `actorUserId`) and from the
 * scheduled weekly job (jobs/payoutRun.job.ts, a "system:" pseudo-actor).
 */
export async function runPayoutBatch(driverId: string, periodStart: Date, periodEnd: Date, actorUserId: string) {
  return db.transaction(async (tx) => {
    const driver = await tx.query.drivers.findFirst({ where: eq(schema.drivers.id, driverId) });
    if (!driver) throw new NotFoundError("Driver", driverId);

    // Atomic claim (conditional UPDATE, not the previous read-then-write) —
    // found by review to be a double-payout race: the weekly scheduled job
    // and an admin's one-off call could both read the same PENDING earnings
    // before either committed. Only filters on periodEnd (an upper bound —
    // don't include earnings created after the window); periodStart is not
    // used to exclude rows, so earnings still PENDING from an earlier failed
    // run aren't left permanently stranded — the payout's periodStart is
    // widened below instead, to honestly reflect what was actually included.
    const claimed = await tx
      .update(schema.driverEarnings)
      .set({ status: "PAID" })
      .where(
        and(
          eq(schema.driverEarnings.driverId, driverId),
          eq(schema.driverEarnings.status, "PENDING"),
          lte(schema.driverEarnings.createdAt, periodEnd)
        )
      )
      .returning();
    if (claimed.length === 0) {
      throw new ConflictError("This driver has no pending earnings to pay out for the given period");
    }

    const amountCents = claimed.reduce((sum, e) => sum + e.amountCents, 0);
    const earliestClaimed = claimed.reduce((min, e) => (e.createdAt < min ? e.createdAt : min), claimed[0].createdAt);
    const effectivePeriodStart = earliestClaimed < periodStart ? earliestClaimed : periodStart;

    const [payout] = await tx
      .insert(schema.payouts)
      .values({ driverId, amountCents, periodStart: effectivePeriodStart, periodEnd, status: "PAID" })
      .returning();

    await recordAudit(tx, {
      // audit_logs.actor_id is a real users.id FK — "system:" pseudo-actors
      // (the scheduled job) aren't UUIDs; same normalization used throughout
      // (see orders.service.ts's transitionOrder, payments.service.ts's issueRefund).
      actorId: actorUserId.startsWith("system:") ? null : actorUserId,
      action: "PAYOUT_RUN",
      entityType: "Payout",
      entityId: payout.id,
      after: { driverId, amountCents, earningsCount: claimed.length },
    });

    return payout;
  });
}

export async function listPayouts(driverId?: string) {
  return db.query.payouts.findMany({
    where: driverId ? eq(schema.payouts.driverId, driverId) : undefined,
    orderBy: (payouts, { desc }) => [desc(payouts.createdAt)],
  });
}
