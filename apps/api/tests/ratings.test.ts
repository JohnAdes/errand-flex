/**
 * Integration tests for ratings/reviews (ratings.service.ts) — previously
 * driver ratingAvg was a static seeded default (5.0) that never updated;
 * this session made it a real, live-computed average. Zero automated
 * coverage before this file.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, pool } from "../src/db";
import * as ratingsService from "../src/modules/ratings/ratings.service";
import { createTestCustomer, createTestDriver, createTestOrder, createAcceptedOffer, cleanupTestData } from "./helpers/fixtures";

let dbReachable = true;
const userIds: string[] = [];
const customerProfileIds: string[] = [];
const driverIds: string[] = [];
const orderIds: string[] = [];

let customerProfileId: string;
let customerUserId: string;
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

  const customer = await createTestCustomer("ratings");
  userIds.push(customer.userId);
  customerProfileIds.push(customer.customerProfileId);
  customerProfileId = customer.customerProfileId;
  customerUserId = customer.userId;

  const driver = await createTestDriver("ratings");
  userIds.push(driver.userId);
  driverIds.push(driver.driverId);
  driverId = driver.driverId;
  driverUserId = driver.userId;

  const otherDriver = await createTestDriver("ratings-other");
  userIds.push(otherDriver.userId);
  driverIds.push(otherDriver.driverId);
  otherDriverId = otherDriver.driverId;
});

afterAll(async () => {
  if (!dbReachable) return;
  await cleanupTestData({ userIds, customerProfileIds, driverIds, orderIds });
  await pool.end();
});

describe("ratings", () => {
  it("requires the order to be DELIVERED before it can be rated", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "IN_TRANSIT" });
    orderIds.push(order.id);
    await createAcceptedOffer(order.id, driverId);

    await expect(
      ratingsService.submitRating({
        orderId: order.id,
        actorUserId: customerUserId,
        raterType: "CUSTOMER",
        value: 5,
        actorCustomerProfileId: customerProfileId,
      })
    ).rejects.toThrow();
  });

  it("a customer rating recomputes the driver's live ratingAvg (real average, not a fixed value)", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order1 = await createTestOrder(customerProfileId, { status: "DELIVERED" });
    orderIds.push(order1.id);
    await createAcceptedOffer(order1.id, driverId);
    await ratingsService.submitRating({
      orderId: order1.id,
      actorUserId: customerUserId,
      raterType: "CUSTOMER",
      value: 3,
      actorCustomerProfileId: customerProfileId,
    });

    let driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.id, driverId) });
    expect(driver?.ratingAvg).toBe(3);

    const order2 = await createTestOrder(customerProfileId, { status: "DELIVERED" });
    orderIds.push(order2.id);
    await createAcceptedOffer(order2.id, driverId);
    await ratingsService.submitRating({
      orderId: order2.id,
      actorUserId: customerUserId,
      raterType: "CUSTOMER",
      value: 5,
      actorCustomerProfileId: customerProfileId,
    });

    driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.id, driverId) });
    expect(driver?.ratingAvg).toBe(4); // (3 + 5) / 2
  });

  it("rejects a second rating of the same type on the same order", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "DELIVERED" });
    orderIds.push(order.id);
    await createAcceptedOffer(order.id, driverId);

    await ratingsService.submitRating({
      orderId: order.id,
      actorUserId: customerUserId,
      raterType: "CUSTOMER",
      value: 4,
      actorCustomerProfileId: customerProfileId,
    });

    await expect(
      ratingsService.submitRating({
        orderId: order.id,
        actorUserId: customerUserId,
        raterType: "CUSTOMER",
        value: 1,
        actorCustomerProfileId: customerProfileId,
      })
    ).rejects.toThrow();
  });

  it("rejects a rating from someone not party to the order", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "DELIVERED" });
    orderIds.push(order.id);
    await createAcceptedOffer(order.id, driverId);

    await expect(
      ratingsService.submitRating({
        orderId: order.id,
        actorUserId: driverUserId,
        raterType: "DRIVER",
        value: 5,
        actorDriverId: otherDriverId,
      })
    ).rejects.toThrow();
  });

  it("rejects an out-of-range value", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const order = await createTestOrder(customerProfileId, { status: "DELIVERED" });
    orderIds.push(order.id);
    await createAcceptedOffer(order.id, driverId);

    await expect(
      ratingsService.submitRating({
        orderId: order.id,
        actorUserId: customerUserId,
        raterType: "CUSTOMER",
        value: 6,
        actorCustomerProfileId: customerProfileId,
      })
    ).rejects.toThrow();
  });
});
