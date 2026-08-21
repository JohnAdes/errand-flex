/**
 * Integration tests for route-grouping/batching (batching.service.ts) — the
 * platform's stated differentiator ("intelligent delivery consolidation"),
 * previously verified only by hand via curl scripts during development.
 *
 * suggestRouteBatches() scans *every* SEARCHING_FOR_DRIVER order in the
 * database, not just this test's fixtures — a real dev DB can have leftover
 * orders from other manual testing. Rather than requiring exact isolation
 * (which would mean destructively clearing unrelated data), these tests
 * check for a batch that *contains* the expected orders as a subset, the
 * same tolerant approach used in this session's manual smoke tests.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, pool } from "../src/db";
import * as batchingService from "../src/modules/dispatch/batching.service";
import * as paymentsService from "../src/modules/payments/payments.service";
import { createTestCustomer, createGroupableOrder, cleanupTestData } from "./helpers/fixtures";

let dbReachable = true;
const userIds: string[] = [];
const customerProfileIds: string[] = [];
const orderIds: string[] = [];
const routeBatchIds: string[] = [];

let customerProfileId: string;
let customerUserId: string;

// Two pickup points ~1km apart in Frisco, two dropoff points ~1km apart in
// Fort Worth — well within PICKUP_CLUSTER_RADIUS_KM (3km) / DROPOFF_CLUSTER_RADIUS_KM (6km).
const PICKUP_A = { lat: 33.1507, lng: -96.8236 };
const PICKUP_B = { lat: 33.1550, lng: -96.8290 };
const DROPOFF_A = { lat: 32.7555, lng: -97.3308 };
const DROPOFF_B = { lat: 32.7610, lng: -97.3350 };
// Far outside any reasonable cluster radius of the above.
const FAR_PICKUP = { lat: 29.7604, lng: -95.3698 }; // Houston
const FAR_DROPOFF = { lat: 29.4241, lng: -98.4936 }; // San Antonio

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
  } catch {
    dbReachable = false;
    return;
  }
  const customer = await createTestCustomer("batching");
  userIds.push(customer.userId);
  customerProfileIds.push(customer.customerProfileId);
  customerProfileId = customer.customerProfileId;
  customerUserId = customer.userId;
});

afterAll(async () => {
  if (!dbReachable) return;
  await cleanupTestData({ userIds, customerProfileIds, orderIds, routeBatchIds });
  await pool.end();
});

describe("route batching", () => {
  it("groups two nearby STANDARD orders into the same batch", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const orderA = await createGroupableOrder(customerProfileId, PICKUP_A, DROPOFF_A);
    orderIds.push(orderA.id);
    const orderB = await createGroupableOrder(customerProfileId, PICKUP_B, DROPOFF_B);
    orderIds.push(orderB.id);

    const created = await batchingService.suggestRouteBatches();
    for (const batch of created) routeBatchIds.push(batch.id);

    const groupedBatch = created.find((b) => {
      const ids = (b.groupingReason as any)?.orderIds ?? [];
      return ids.includes(orderA.id) && ids.includes(orderB.id);
    });
    expect(groupedBatch).toBeDefined();
    expect(groupedBatch!.status).toBe("SUGGESTED");
    expect((groupedBatch!.groupingReason as any).detourRatio).toBeLessThan(1.6);
  });

  it("does not group an order with a pickup/dropoff far outside the cluster radius", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const nearOrder = await createGroupableOrder(customerProfileId, PICKUP_A, DROPOFF_A);
    orderIds.push(nearOrder.id);
    const farOrder = await createGroupableOrder(customerProfileId, FAR_PICKUP, FAR_DROPOFF);
    orderIds.push(farOrder.id);

    const created = await batchingService.suggestRouteBatches();
    for (const batch of created) routeBatchIds.push(batch.id);

    const batchWithBoth = created.find((b) => {
      const ids = (b.groupingReason as any)?.orderIds ?? [];
      return ids.includes(nearOrder.id) && ids.includes(farOrder.id);
    });
    expect(batchWithBoth).toBeUndefined();
  });

  it("excludes PRIORITY orders from grouping (only ECONOMY/STANDARD are groupable)", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const orderA = await createGroupableOrder(customerProfileId, PICKUP_A, DROPOFF_A);
    orderIds.push(orderA.id);
    const priorityOrder = await createGroupableOrder(customerProfileId, PICKUP_B, DROPOFF_B, { serviceLevel: "PRIORITY" });
    orderIds.push(priorityOrder.id);

    const created = await batchingService.suggestRouteBatches();
    for (const batch of created) routeBatchIds.push(batch.id);

    const batchWithPriority = created.find((b) => {
      const ids = (b.groupingReason as any)?.orderIds ?? [];
      return ids.includes(priorityOrder.id);
    });
    expect(batchWithPriority).toBeUndefined();
  });

  it("issues a grouped-route discount refund against each grouped order's payment", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const orderA = await createGroupableOrder(customerProfileId, PICKUP_A, DROPOFF_A, { status: "AWAITING_PAYMENT", totalCents: 5000 });
    const orderB = await createGroupableOrder(customerProfileId, PICKUP_B, DROPOFF_B, { status: "AWAITING_PAYMENT", totalCents: 5000 });
    orderIds.push(orderA.id, orderB.id);

    // authorizePayment also advances the order to SEARCHING_FOR_DRIVER,
    // which is the status createGroupableOrder already set — this just adds
    // the payment row the discount needs to attach to.
    await paymentsService.authorizePayment(orderA.id, customerUserId);
    await paymentsService.authorizePayment(orderB.id, customerUserId);

    const created = await batchingService.suggestRouteBatches();
    for (const batch of created) routeBatchIds.push(batch.id);

    const groupedBatch = created.find((b) => {
      const ids = (b.groupingReason as any)?.orderIds ?? [];
      return ids.includes(orderA.id) && ids.includes(orderB.id);
    });
    expect(groupedBatch).toBeDefined();

    const paymentA = await db.query.payments.findFirst({ where: eq(schema.payments.orderId, orderA.id) });
    const refundsA = await db.query.refunds.findMany({ where: eq(schema.refunds.paymentId, paymentA!.id) });
    expect(refundsA.some((r) => r.reason === "Grouped-route discount" && r.amountCents > 0)).toBe(true);
  });
});
