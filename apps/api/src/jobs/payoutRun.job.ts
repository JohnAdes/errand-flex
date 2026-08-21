import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { runPayoutBatch } from "../modules/payments/payouts.service";

/**
 * Scheduled weekly payout run (02-architecture.md §7: "payout batch run
 * (scheduled)"). Complements — doesn't replace — the admin-triggered
 * `POST /v1/admin/payouts/run` one-off endpoint: this sweeps every driver
 * with pending earnings automatically; the admin endpoint stays for
 * ad-hoc/one-driver runs. Continues past a single driver's failure (e.g. a
 * race where their earnings got claimed by a concurrent run) rather than
 * aborting the whole sweep.
 */
export async function runScheduledPayoutRun() {
  const now = new Date();
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const driversWithPending = await db
    .selectDistinct({ driverId: schema.driverEarnings.driverId })
    .from(schema.driverEarnings)
    .where(eq(schema.driverEarnings.status, "PENDING"));

  let payoutsCreated = 0;
  for (const { driverId } of driversWithPending) {
    try {
      await runPayoutBatch(driverId, periodStart, now, "system:scheduled-payout-run");
      payoutsCreated++;
    } catch (err) {
      console.error(`[jobs] payout run failed for driver ${driverId}:`, err instanceof Error ? err.message : err);
    }
  }

  return { payoutsCreated };
}
