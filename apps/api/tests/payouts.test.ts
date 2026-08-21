/**
 * Integration tests for payout batching (payouts.service.ts) — previously
 * zero coverage. Written after a code-review pass found a double-payout race
 * (concurrent runs could both claim the same PENDING earnings) and a
 * period-mislabeling bug (periodStart/periodEnd stored but never enforced).
 * Talks to a real Postgres database, same reasoning as
 * dispatch.concurrency.test.ts — atomicity under real concurrent load isn't
 * something a mock ORM can meaningfully verify.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, pool } from "../src/db";
import * as payoutsService from "../src/modules/payments/payouts.service";
import { createTestDriver, cleanupTestData } from "./helpers/fixtures";

let dbReachable = true;
const userIds: string[] = [];
const driverIds: string[] = [];

let driverId: string;
let adminUserId: string;

async function addEarning(amountCents: number, createdAt?: Date) {
  const [earning] = await db
    .insert(schema.driverEarnings)
    .values({
      driverId,
      amountCents,
      type: "DELIVERY_PAYOUT",
      status: "PENDING",
      ...(createdAt ? { createdAt } : {}),
    })
    .returning();
  return earning;
}

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
  } catch {
    dbReachable = false;
    return;
  }

  const driver = await createTestDriver("payouts");
  userIds.push(driver.userId);
  driverIds.push(driver.driverId);
  driverId = driver.driverId;

  const [admin] = await db
    .insert(schema.users)
    .values({
      email: `test-payouts-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      passwordHash: "not-a-real-hash",
      role: "SUPER_ADMIN",
    })
    .returning();
  userIds.push(admin.id);
  adminUserId = admin.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  await cleanupTestData({ userIds, driverIds });
  await pool.end();
});

describe("payout batching", () => {
  it("pays out exactly the driver's pending earnings and marks them PAID", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    await addEarning(1000);
    await addEarning(1500);

    const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date();
    const payout = await payoutsService.runPayoutBatch(driverId, periodStart, periodEnd, adminUserId);
    expect(payout.amountCents).toBe(2500);

    const stillPending = await db.query.driverEarnings.findMany({
      where: and(eq(schema.driverEarnings.driverId, driverId), eq(schema.driverEarnings.status, "PENDING")),
    });
    expect(stillPending.length).toBe(0);
  });

  it("prevents two concurrent runs for the same driver from double-paying the same earnings", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    await addEarning(2000);
    const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date();

    // Real concurrency, same reasoning as dispatch.concurrency.test.ts's
    // acceptOffer test — this is the exact race the fix (atomic conditional
    // UPDATE instead of read-then-write) is meant to close.
    const results = await Promise.allSettled([
      payoutsService.runPayoutBatch(driverId, periodStart, periodEnd, adminUserId),
      payoutsService.runPayoutBatch(driverId, periodStart, periodEnd, adminUserId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const payouts = await db.query.payouts.findMany({ where: eq(schema.payouts.driverId, driverId) });
    const payoutsForThisEarning = payouts.filter((p) => p.amountCents === 2000);
    expect(payoutsForThisEarning.length).toBe(1);
  });

  it("widens the persisted periodStart to include an older stuck-PENDING earning rather than orphaning it", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await addEarning(500, oldDate);
    await addEarning(700);

    // A narrower window than the 30-day-old earning — it should still be
    // swept in rather than left PENDING forever, per the fix.
    const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date();
    const payout = await payoutsService.runPayoutBatch(driverId, periodStart, periodEnd, adminUserId);

    expect(payout.amountCents).toBe(1200);
    expect(payout.periodStart.getTime()).toBeLessThanOrEqual(oldDate.getTime());
  });

  it("rejects a run when there are no pending earnings within the period", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const periodStart = new Date(Date.now() - 1000);
    const periodEnd = new Date();
    await expect(payoutsService.runPayoutBatch(driverId, periodStart, periodEnd, adminUserId)).rejects.toThrow();
  });
});
