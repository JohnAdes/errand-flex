/**
 * Integration test for custody.service.ts's batch-delivery payout — added
 * after a code-review pass found verifyDelivery credited a route batch's
 * flat payoutCents in full on every order in the batch (instead of split
 * across them), tripling+ the driver's actual earnings on a multi-order
 * batch. Talks to a real Postgres database, same reasoning as
 * dispatch.concurrency.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema, pool } from "../src/db";
import * as custodyService from "../src/modules/custody/custody.service";
import { createTestCustomer, createTestDriver, createGroupableOrder, cleanupTestData } from "./helpers/fixtures";

let dbReachable = true;
const userIds: string[] = [];
const customerProfileIds: string[] = [];
const driverIds: string[] = [];
const orderIds: string[] = [];
const routeBatchIds: string[] = [];

let customerProfileId: string;
let driverId: string;

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
  } catch {
    dbReachable = false;
    return;
  }

  const customer = await createTestCustomer("custody-batch");
  userIds.push(customer.userId);
  customerProfileIds.push(customer.customerProfileId);
  customerProfileId = customer.customerProfileId;

  const driver = await createTestDriver("custody-batch");
  userIds.push(driver.userId);
  driverIds.push(driver.driverId);
  driverId = driver.driverId;
});

afterAll(async () => {
  if (!dbReachable) return;
  await cleanupTestData({ userIds, customerProfileIds, driverIds, orderIds, routeBatchIds });
  await pool.end();
});

describe("custody batch delivery payout", () => {
  it("splits a batch's flat payout evenly across each order's delivery instead of crediting it in full per order", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const pickup = { lat: 33.15, lng: -96.82 };
    const dropoff = { lat: 32.75, lng: -97.33 };
    const orderA = await createGroupableOrder(customerProfileId, pickup, dropoff, {
      status: "DELIVERY_VERIFICATION_IN_PROGRESS",
    });
    const orderB = await createGroupableOrder(customerProfileId, pickup, dropoff, {
      status: "DELIVERY_VERIFICATION_IN_PROGRESS",
    });
    orderIds.push(orderA.id, orderB.id);

    const [batch] = await db
      .insert(schema.routeBatches)
      .values({ driverId, status: "ASSIGNED", createdBy: "SYSTEM" })
      .returning();
    routeBatchIds.push(batch.id);

    for (const order of [orderA, orderB]) {
      const dropoffStop = await db.query.stops.findFirst({
        where: and(eq(schema.stops.orderId, order.id), eq(schema.stops.type, "DROPOFF")),
      });
      await db
        .insert(schema.routeAssignments)
        .values({ routeBatchId: batch.id, stopId: dropoffStop!.id, orderId: order.id, sequenceNo: 1 });
    }

    // One flat payout for the whole batch — the exact shape
    // createBatchOfferRound produces (dispatch.service.ts).
    await db.insert(schema.driverOffers).values({
      routeBatchId: batch.id,
      driverId,
      payoutCents: 3000,
      status: "ACCEPTED",
      expiresAt: new Date(Date.now() + 60_000),
    });

    for (const order of [orderA, orderB]) {
      await custodyService.verifyDelivery({
        orderId: order.id,
        driverId,
        driverLat: dropoff.lat,
        driverLng: dropoff.lng,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        outcome: "DELIVERED",
        recipientName: "Test Recipient",
        pinUsed: true,
        contactless: true,
      });
    }

    const earnings = await db.query.driverEarnings.findMany({ where: eq(schema.driverEarnings.driverId, driverId) });
    expect(earnings.length).toBe(2);
    const total = earnings.reduce((sum, e) => sum + e.amountCents, 0);
    // Must total the batch's actual flat payout (3000), not 6000 — the
    // pre-fix bug credited the full 3000 to each of the 2 orders.
    expect(total).toBe(3000);
    expect(earnings.every((e) => e.amountCents === 1500)).toBe(true);
  });
});
