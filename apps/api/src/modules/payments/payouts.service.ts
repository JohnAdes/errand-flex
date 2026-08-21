import { and, eq, inArray } from "drizzle-orm";
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

    const pending = await tx.query.driverEarnings.findMany({
      where: and(eq(schema.driverEarnings.driverId, driverId), eq(schema.driverEarnings.status, "PENDING")),
    });
    if (pending.length === 0) {
      throw new ConflictError("This driver has no pending earnings to pay out");
    }

    const amountCents = pending.reduce((sum, e) => sum + e.amountCents, 0);

    const [payout] = await tx
      .insert(schema.payouts)
      .values({ driverId, amountCents, periodStart, periodEnd, status: "PAID" })
      .returning();

    await tx
      .update(schema.driverEarnings)
      .set({ status: "PAID" })
      .where(inArray(schema.driverEarnings.id, pending.map((e) => e.id)));

    await recordAudit(tx, {
      // audit_logs.actor_id is a real users.id FK — "system:" pseudo-actors
      // (the scheduled job) aren't UUIDs; same normalization used throughout
      // (see orders.service.ts's transitionOrder, payments.service.ts's issueRefund).
      actorId: actorUserId.startsWith("system:") ? null : actorUserId,
      action: "PAYOUT_RUN",
      entityType: "Payout",
      entityId: payout.id,
      after: { driverId, amountCents, earningsCount: pending.length },
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
