/**
 * Shared test-fixture helpers for the integration tests in this directory.
 * Each of these tests talks to a real Postgres database (see
 * dispatch.concurrency.test.ts's comment on why — atomicity/aggregation
 * properties a mock ORM can't meaningfully verify) and needs the same basic
 * building blocks (a user+customer profile, a user+driver, an order). This
 * factors that setup into one place instead of copy-pasting it per test
 * file — the code review pass that led to this test suite flagged exactly
 * that kind of duplication as a real maintenance risk elsewhere.
 */
import bcrypt from "bcryptjs";
import { db, schema } from "../../src/db";

let passwordHashCache: string | null = null;
async function testPasswordHash(): Promise<string> {
  if (!passwordHashCache) passwordHashCache = await bcrypt.hash("test-password", 4);
  return passwordHashCache;
}

function uniqueEmail(label: string): string {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function createTestCustomer(label = "customer") {
  const [user] = await db
    .insert(schema.users)
    .values({ email: uniqueEmail(label), passwordHash: await testPasswordHash(), role: "CUSTOMER" })
    .returning();
  const [profile] = await db
    .insert(schema.customerProfiles)
    .values({ userId: user.id, displayName: `Test Customer (${label})` })
    .returning();
  return { userId: user.id, customerProfileId: profile.id };
}

export async function createTestDriver(label = "driver", overrides: Partial<typeof schema.drivers.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: uniqueEmail(label), passwordHash: await testPasswordHash(), role: "DRIVER" })
    .returning();
  const [driver] = await db
    .insert(schema.drivers)
    .values({ userId: user.id, status: "APPROVED", onlineStatus: true, ...overrides })
    .returning();
  return { userId: user.id, driverId: driver.id };
}

export async function createTestOrder(customerProfileId: string, overrides: Partial<typeof schema.orders.$inferInsert> = {}) {
  const [order] = await db
    .insert(schema.orders)
    .values({
      customerProfileId,
      status: "AWAITING_PAYMENT",
      serviceLevel: "STANDARD",
      totalCents: 2000,
      ...overrides,
    })
    .returning();
  return order;
}

/** Direct single-order ACCEPTED offer — the shape getAcceptedOfferForOrder looks for. */
export async function createAcceptedOffer(orderId: string, driverId: string, payoutCents = 1500) {
  const [offer] = await db
    .insert(schema.driverOffers)
    .values({ orderId, driverId, payoutCents, status: "ACCEPTED", expiresAt: new Date(Date.now() + 60_000) })
    .returning();
  return offer;
}

export async function createTestPayment(orderId: string, amountCents: number, status: "AUTHORIZED" | "CAPTURED" = "AUTHORIZED") {
  const [payment] = await db
    .insert(schema.payments)
    .values({
      orderId,
      stripePaymentIntentId: `test_pi_${Math.random().toString(36).slice(2)}`,
      amountCents,
      status,
      capturedAt: status === "CAPTURED" ? new Date() : undefined,
    })
    .returning();
  return payment;
}

/**
 * A full order with real pickup/dropoff addresses+stops and one package —
 * what batching.service.ts's candidate query actually needs (`with: {
 * packages: true, stops: { with: { address: true } } }`). `createTestOrder`
 * alone doesn't create stops/packages, since most other tests don't need them.
 */
export async function createGroupableOrder(
  customerProfileId: string,
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
  overrides: Partial<typeof schema.orders.$inferInsert> = {}
) {
  const order = await createTestOrder(customerProfileId, { status: "SEARCHING_FOR_DRIVER", serviceLevel: "STANDARD", ...overrides });

  const [pickupAddress] = await db
    .insert(schema.addresses)
    .values({ line1: "1 Pickup St", city: "Frisco", state: "TX", postal: "75034", lat: pickup.lat, lng: pickup.lng })
    .returning();
  const [dropoffAddress] = await db
    .insert(schema.addresses)
    .values({ line1: "1 Dropoff Ave", city: "Fort Worth", state: "TX", postal: "76102", lat: dropoff.lat, lng: dropoff.lng })
    .returning();

  await db.insert(schema.stops).values([
    { orderId: order.id, type: "PICKUP", addressId: pickupAddress.id, sequenceNo: 1 },
    { orderId: order.id, type: "DROPOFF", addressId: dropoffAddress.id, sequenceNo: 2, recipientName: "Test Recipient", recipientPhone: "555-0100" },
  ]);
  await db.insert(schema.packages).values({ orderId: order.id, category: "SMALL_PARCEL", weightKg: 2, quantity: 1 });

  return order;
}

/** Deletes rows across every table these fixtures might touch, in FK-safe order. Safe to call with empty arrays. */
export async function cleanupTestData(ids: {
  userIds?: string[];
  customerProfileIds?: string[];
  driverIds?: string[];
  orderIds?: string[];
  businessAccountIds?: string[];
  routeBatchIds?: string[];
}) {
  const { eq, inArray } = await import("drizzle-orm");
  const orderIds = ids.orderIds ?? [];
  if (ids.routeBatchIds?.length) {
    await db.delete(schema.driverOffers).where(inArray(schema.driverOffers.routeBatchId, ids.routeBatchIds));
    await db.delete(schema.routeAssignments).where(inArray(schema.routeAssignments.routeBatchId, ids.routeBatchIds));
    await db.delete(schema.routeBatches).where(inArray(schema.routeBatches.id, ids.routeBatchIds));
  }
  if (orderIds.length) {
    await db.delete(schema.ratings).where(inArray(schema.ratings.orderId, orderIds));
    await db.delete(schema.claimsDisputes).where(inArray(schema.claimsDisputes.orderId, orderIds));
    const payments = await db.query.payments.findMany({ where: inArray(schema.payments.orderId, orderIds) });
    if (payments.length) {
      await db.delete(schema.refunds).where(inArray(schema.refunds.paymentId, payments.map((p) => p.id)));
      await db.delete(schema.payments).where(inArray(schema.payments.orderId, orderIds));
    }
    await db.delete(schema.driverEarnings).where(inArray(schema.driverEarnings.orderId, orderIds));
    await db.delete(schema.routeAssignments).where(inArray(schema.routeAssignments.orderId, orderIds));
    await db.delete(schema.driverOffers).where(inArray(schema.driverOffers.orderId, orderIds));
    await db.delete(schema.chainOfCustodyEvents).where(inArray(schema.chainOfCustodyEvents.orderId, orderIds));
    await db.delete(schema.pickupVerifications).where(inArray(schema.pickupVerifications.orderId, orderIds));
    await db.delete(schema.deliveryVerifications).where(inArray(schema.deliveryVerifications.orderId, orderIds));
    await db.delete(schema.stops).where(inArray(schema.stops.orderId, orderIds));
    await db.delete(schema.packages).where(inArray(schema.packages.orderId, orderIds));
    await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds));
  }
  for (const id of ids.driverIds ?? []) {
    await db.delete(schema.payouts).where(eq(schema.payouts.driverId, id));
    await db.delete(schema.driverEarnings).where(eq(schema.driverEarnings.driverId, id));
    await db.delete(schema.driverOffers).where(eq(schema.driverOffers.driverId, id));
    await db.delete(schema.vehicles).where(eq(schema.vehicles.driverId, id));
    await db.delete(schema.driverDocuments).where(eq(schema.driverDocuments.driverId, id));
    await db.delete(schema.drivers).where(eq(schema.drivers.id, id));
  }
  for (const id of ids.customerProfileIds ?? []) {
    await db.update(schema.customerProfiles).set({ businessAccountId: null }).where(eq(schema.customerProfiles.id, id));
    await db.delete(schema.customerProfiles).where(eq(schema.customerProfiles.id, id));
  }
  for (const id of ids.businessAccountIds ?? []) {
    await db.delete(schema.businessAccounts).where(eq(schema.businessAccounts.id, id));
  }
  if (ids.userIds?.length) {
    // audit_logs.actor_id is a real FK to users.id — every service function
    // this test suite exercises writes an audit row, so this always has
    // something to clean up.
    await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.actorId, ids.userIds));
    await db.delete(schema.users).where(inArray(schema.users.id, ids.userIds));
  }
}
