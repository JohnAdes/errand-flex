/**
 * Integration tests for the claims/disputes module (claims.service.ts) —
 * closed the admin "exceptions" gap this session, previously verified only
 * by hand via curl, with zero automated coverage.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, pool } from "../src/db";
import * as claimsService from "../src/modules/claims/claims.service";
import * as paymentsService from "../src/modules/payments/payments.service";
import { createTestCustomer, createTestDriver, createTestOrder, createAcceptedOffer, cleanupTestData } from "./helpers/fixtures";

let dbReachable = true;
const userIds: string[] = [];
const customerProfileIds: string[] = [];
const driverIds: string[] = [];
const orderIds: string[] = [];

let customerProfileId: string;
let customerUserId: string;
let otherCustomerProfileId: string;
let driverId: string;
let driverUserId: string;
let otherDriverId: string;

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
  } catch {
    dbReachable = false;
    return;
  }

  const customer = await createTestCustomer("claims");
  userIds.push(customer.userId);
  customerProfileIds.push(customer.customerProfileId);
  customerProfileId = customer.customerProfileId;
  customerUserId = customer.userId;

  const otherCustomer = await createTestCustomer("claims-other");
  userIds.push(otherCustomer.userId);
  customerProfileIds.push(otherCustomer.customerProfileId);
  otherCustomerProfileId = otherCustomer.customerProfileId;

  const driver = await createTestDriver("claims");
  userIds.push(driver.userId);
  driverIds.push(driver.driverId);
  driverId = driver.driverId;
  driverUserId = driver.userId;

  const otherDriver = await createTestDriver("claims-other");
  userIds.push(otherDriver.userId);
  driverIds.push(otherDriver.driverId);
  otherDriverId = otherDriver.driverId;
});

afterAll(async () => {
  if (!dbReachable) return;
  await cleanupTestData({ userIds, customerProfileIds, driverIds, orderIds });
  await pool.end();
});

describe("claims / disputes", () => {
  it("lets the order's own customer file a claim", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "DELIVERED" });
    orderIds.push(order.id);

    const claim = await claimsService.createClaim({
      orderId: order.id,
      actorUserId: customerUserId,
      actorCustomerProfileId: customerProfileId,
      type: "DAMAGED",
      description: "Box arrived crushed",
    });
    expect(claim.status).toBe("OPEN");
    expect(claim.type).toBe("DAMAGED");
  });

  it("forbids a different customer from filing a claim on someone else's order", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "DELIVERED" });
    orderIds.push(order.id);

    await expect(
      claimsService.createClaim({
        orderId: order.id,
        actorUserId: customerUserId,
        actorCustomerProfileId: otherCustomerProfileId,
        type: "LOST",
        description: "Not mine but trying anyway",
      })
    ).rejects.toThrow();
  });

  it("lets the assigned driver file a claim, but not an unrelated driver", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "DELIVERED" });
    orderIds.push(order.id);
    await createAcceptedOffer(order.id, driverId);

    const claim = await claimsService.createClaim({
      orderId: order.id,
      actorUserId: driverUserId,
      actorDriverId: driverId,
      type: "LATE",
      description: "Recipient wasn't available, delivered 2 hours late",
    });
    expect(claim.status).toBe("OPEN");

    await expect(
      claimsService.createClaim({
        orderId: order.id,
        actorUserId: driverUserId,
        actorDriverId: otherDriverId,
        type: "OTHER",
        description: "I wasn't even on this order",
      })
    ).rejects.toThrow();
  });

  it("resolving with a refund issues a real refund against the order's payment", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "AWAITING_PAYMENT", totalCents: 3000 });
    orderIds.push(order.id);
    await paymentsService.authorizePayment(order.id, customerUserId);
    await db.transaction((tx) => paymentsService.capturePaymentForOrder(tx, order.id));
    await db.update(schema.orders).set({ status: "DELIVERED" }).where(eq(schema.orders.id, order.id));

    const claim = await claimsService.createClaim({
      orderId: order.id,
      actorUserId: customerUserId,
      actorCustomerProfileId: customerProfileId,
      type: "DAMAGED",
      description: "Cosmetic damage",
    });

    const resolved = await claimsService.resolveClaim(claim.id, driverUserId, "RESOLVED", "Partial refund for cosmetic damage", 500);
    expect(resolved.status).toBe("RESOLVED");

    const payment = await db.query.payments.findFirst({ where: eq(schema.payments.orderId, order.id) });
    expect(payment?.status).toBe("PARTIALLY_REFUNDED");
    const refunds = await db.query.refunds.findMany({ where: eq(schema.refunds.paymentId, payment!.id) });
    expect(refunds.some((r) => r.amountCents === 500 && r.reason.includes("Claim resolution"))).toBe(true);
  });

  it("rejects a refund on a REJECTED outcome, and rejects resolving an already-resolved claim", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "DELIVERED" });
    orderIds.push(order.id);
    const claim = await claimsService.createClaim({
      orderId: order.id,
      actorUserId: customerUserId,
      actorCustomerProfileId: customerProfileId,
      type: "OTHER",
      description: "Complaint without merit",
    });

    await expect(claimsService.resolveClaim(claim.id, driverUserId, "REJECTED", "No evidence of damage", 500)).rejects.toThrow();

    const resolved = await claimsService.resolveClaim(claim.id, driverUserId, "REJECTED", "No evidence of damage");
    expect(resolved.status).toBe("REJECTED");

    await expect(claimsService.resolveClaim(claim.id, driverUserId, "RESOLVED", "Changed my mind")).rejects.toThrow();
  });
});
