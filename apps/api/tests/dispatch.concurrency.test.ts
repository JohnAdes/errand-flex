/**
 * Integration test for the single most important correctness guarantee in
 * the system: exactly one driver can accept a given offer, even under real
 * concurrent load (01-product-specification.md §11 acceptance criteria).
 *
 * This is a genuine integration test — it talks to a real Postgres database
 * (via DATABASE_URL) rather than mocking the DB, because the property being
 * tested (atomicity of a conditional UPDATE under concurrency) is exactly
 * the kind of thing a mock can't meaningfully verify — a mock ORM call
 * doesn't have real row-level locking behavior to get right or wrong.
 *
 * Run `docker compose up -d` (or otherwise have DATABASE_URL reachable)
 * before running this test — it's skipped automatically if the DB isn't
 * reachable so `npm test` still passes in environments without a DB (e.g. a
 * basic CI lint-only stage), but you should run it for real before trusting
 * any change to dispatch.service.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, schema, pool } from "../src/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as dispatchService from "../src/modules/dispatch/dispatch.service";

let dbReachable = true;
const createdUserIds: string[] = [];
const createdDriverIds: string[] = [];
const createdCustomerProfileIds: string[] = [];
let orderId: string;
let offerId: string;

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
  } catch {
    dbReachable = false;
    return;
  }

  // Seed minimal fixtures: one customer profile + order in SEARCHING_FOR_DRIVER-
  // equivalent state is more setup than this test needs — we only need an
  // order row and a PENDING driver_offer row, since acceptOffer() only reads
  // driver_offers + drivers + (via transitionOrder) orders.
  const passwordHash = await bcrypt.hash("test-password", 4);

  const [customerUser] = await db
    .insert(schema.users)
    .values({ email: `concurrency-test-customer-${Date.now()}@example.com`, passwordHash, role: "CUSTOMER" })
    .returning();
  createdUserIds.push(customerUser.id);
  const [customerProfile] = await db
    .insert(schema.customerProfiles)
    .values({ userId: customerUser.id, displayName: "Concurrency Test Customer" })
    .returning();
  createdCustomerProfileIds.push(customerProfile.id);

  const [order] = await db
    .insert(schema.orders)
    .values({
      customerProfileId: customerProfile.id,
      status: "DRIVER_OFFERED",
      serviceLevel: "STANDARD",
      totalCents: 1000,
    })
    .returning();
  orderId = order.id;

  const [driverUser] = await db
    .insert(schema.users)
    .values({ email: `concurrency-test-driver-${Date.now()}@example.com`, passwordHash, role: "DRIVER" })
    .returning();
  createdUserIds.push(driverUser.id);
  const [driver] = await db
    .insert(schema.drivers)
    .values({ userId: driverUser.id, status: "APPROVED", onlineStatus: true })
    .returning();
  createdDriverIds.push(driver.id);

  const [offer] = await db
    .insert(schema.driverOffers)
    .values({
      orderId: order.id,
      driverId: driver.id,
      payoutCents: 800,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  offerId = offer.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  // Best-effort cleanup — order matters for FK constraints.
  if (offerId) await db.delete(schema.driverOffers).where(eq(schema.driverOffers.id, offerId));
  if (orderId) await db.delete(schema.orders).where(eq(schema.orders.id, orderId));
  for (const id of createdCustomerProfileIds) await db.delete(schema.customerProfiles).where(eq(schema.customerProfiles.id, id));
  for (const id of createdDriverIds) await db.delete(schema.drivers).where(eq(schema.drivers.id, id));
  for (const id of createdUserIds) await db.delete(schema.users).where(eq(schema.users.id, id));
  await pool.end();
});

describe("dispatch concurrency", () => {
  it("allows exactly one of many concurrent accept attempts to succeed", async () => {
    if (!dbReachable) {
      console.warn("Skipping concurrency test — DATABASE_URL not reachable. Run `docker compose up -d` first.");
      return;
    }

    const driverId = createdDriverIds[0];
    const CONCURRENT_ATTEMPTS = 15;

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_ATTEMPTS }, () => dispatchService.acceptOffer(offerId, driverId))
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(CONCURRENT_ATTEMPTS - 1);

    const finalOffer = await db.query.driverOffers.findFirst({ where: eq(schema.driverOffers.id, offerId) });
    expect(finalOffer?.status).toBe("ACCEPTED");
  });
});
