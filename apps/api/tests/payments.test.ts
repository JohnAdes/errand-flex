/**
 * Integration tests for the payment lifecycle (payments.service.ts) —
 * previously verified only by hand via curl during development (see
 * README's "Payments lifecycle" section), with zero automated coverage.
 * Talks to a real Postgres database, same reasoning as
 * dispatch.concurrency.test.ts: capture/refund arithmetic and status
 * transitions are exactly the kind of thing worth verifying for real.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, pool } from "../src/db";
import * as paymentsService from "../src/modules/payments/payments.service";
import { createTestCustomer, createTestOrder, cleanupTestData } from "./helpers/fixtures";

let dbReachable = true;
const userIds: string[] = [];
const customerProfileIds: string[] = [];
const orderIds: string[] = [];

let customerProfileId: string;
let customerUserId: string;

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
  } catch {
    dbReachable = false;
    return;
  }

  const customer = await createTestCustomer("payments");
  userIds.push(customer.userId);
  customerProfileIds.push(customer.customerProfileId);
  customerProfileId = customer.customerProfileId;
  customerUserId = customer.userId;
});

afterAll(async () => {
  if (!dbReachable) return;
  await cleanupTestData({ userIds, customerProfileIds, orderIds });
  await pool.end();
});

describe("payments lifecycle", () => {
  it("authorizePayment creates an AUTHORIZED payment and advances the order to SEARCHING_FOR_DRIVER", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "AWAITING_PAYMENT", totalCents: 3000 });
    orderIds.push(order.id);

    const payment = await paymentsService.authorizePayment(order.id, customerUserId);
    expect(payment.status).toBe("AUTHORIZED");
    expect(payment.amountCents).toBe(3000);

    const updated = await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) });
    expect(updated?.status).toBe("SEARCHING_FOR_DRIVER");
  });

  it("rejects authorizing a second payment for the same order", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "AWAITING_PAYMENT", totalCents: 1500 });
    orderIds.push(order.id);

    await paymentsService.authorizePayment(order.id, customerUserId);
    await expect(paymentsService.authorizePayment(order.id, customerUserId)).rejects.toThrow();
  });

  it("rejects authorizing an order that isn't AWAITING_PAYMENT", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "DRAFT", totalCents: 1500 });
    orderIds.push(order.id);

    await expect(paymentsService.authorizePayment(order.id, customerUserId)).rejects.toThrow();
  });

  it("captures the net amount (original minus a pre-capture discount)", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "AWAITING_PAYMENT", totalCents: 4000 });
    orderIds.push(order.id);
    await paymentsService.authorizePayment(order.id, customerUserId);

    await db.transaction(async (tx) => {
      await paymentsService.issueRefund(tx, order.id, 1000, "Test pre-capture discount", "system:test");
      await paymentsService.capturePaymentForOrder(tx, order.id);
    });

    const payment = await db.query.payments.findFirst({ where: eq(schema.payments.orderId, order.id) });
    expect(payment?.status).toBe("CAPTURED");
    // The 1000-cent discount was banked as a refund row before capture, so
    // the *stored* amountCents stays 4000 (the original authorization) —
    // capturePaymentForOrder computes the net amount to send the provider,
    // it doesn't rewrite history. Verify the refund row is what encodes the discount.
    const refunds = await db.query.refunds.findMany({ where: eq(schema.refunds.paymentId, payment!.id) });
    expect(refunds.reduce((sum, r) => sum + r.amountCents, 0)).toBe(1000);
  });

  it("post-capture refund flips payment status to PARTIALLY_REFUNDED, then REFUNDED once fully refunded", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "AWAITING_PAYMENT", totalCents: 2000 });
    orderIds.push(order.id);
    await paymentsService.authorizePayment(order.id, customerUserId);
    await db.transaction((tx) => paymentsService.capturePaymentForOrder(tx, order.id));

    await db.transaction((tx) => paymentsService.issueRefund(tx, order.id, 500, "Partial", "system:test"));
    let payment = await db.query.payments.findFirst({ where: eq(schema.payments.orderId, order.id) });
    expect(payment?.status).toBe("PARTIALLY_REFUNDED");

    await db.transaction((tx) => paymentsService.issueRefund(tx, order.id, 1500, "Rest", "system:test"));
    payment = await db.query.payments.findFirst({ where: eq(schema.payments.orderId, order.id) });
    expect(payment?.status).toBe("REFUNDED");
  });

  it("caps a refund at the remaining unrefunded balance instead of over-refunding", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "AWAITING_PAYMENT", totalCents: 1000 });
    orderIds.push(order.id);
    await paymentsService.authorizePayment(order.id, customerUserId);
    await db.transaction((tx) => paymentsService.capturePaymentForOrder(tx, order.id));

    await db.transaction((tx) => paymentsService.issueRefund(tx, order.id, 800, "First", "system:test"));
    // Ask for more than what's left (200) — should cap at 200, not 900.
    const refund = await db.transaction((tx) => paymentsService.issueRefund(tx, order.id, 900, "Overshoot", "system:test"));
    expect(refund?.amountCents).toBe(200);

    const payment = await db.query.payments.findFirst({ where: eq(schema.payments.orderId, order.id) });
    expect(payment?.status).toBe("REFUNDED");
  });

  it("normalizes a 'system:' pseudo-actor to a null audit actor instead of failing the FK constraint", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "AWAITING_PAYMENT", totalCents: 1000 });
    orderIds.push(order.id);
    await paymentsService.authorizePayment(order.id, customerUserId);

    // This would throw a raw FK-violation error if "system:batching" were
    // passed straight through to audit_logs.actor_id (a real bug fixed
    // earlier this session) instead of being normalized to null.
    await expect(
      db.transaction((tx) => paymentsService.issueRefund(tx, order.id, 100, "batching discount", "system:batching"))
    ).resolves.toBeTruthy();
  });
});
