/**
 * Integration tests for business accounts (business.service.ts) — the
 * "small business lacks affordable local logistics" gap this session closed
 * with real per-business volume pricing. Zero automated coverage before
 * this file; getMonthlyOrderCountForBusinessAccount in particular is a live
 * DB aggregation exactly worth verifying for real rather than mocking.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, pool } from "../src/db";
import * as businessService from "../src/modules/business/business.service";
import { createTestCustomer, createTestOrder, cleanupTestData } from "./helpers/fixtures";

let dbReachable = true;
const userIds: string[] = [];
const customerProfileIds: string[] = [];
const orderIds: string[] = [];
const businessAccountIds: string[] = [];

let adminUserId: string;

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
  } catch {
    dbReachable = false;
    return;
  }
  const admin = await createTestCustomer("business-admin-actor");
  userIds.push(admin.userId);
  customerProfileIds.push(admin.customerProfileId);
  adminUserId = admin.userId;
});

afterAll(async () => {
  if (!dbReachable) return;
  await cleanupTestData({ userIds, customerProfileIds, orderIds, businessAccountIds });
  await pool.end();
});

describe("business accounts", () => {
  it("creates an account with the given discount tiers and no members", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const account = await businessService.createBusinessAccount({
      name: "Acme Retail",
      contactEmail: "ops@acme.example",
      discountTiers: [{ minOrdersPerMonth: 10, discountPercent: 5 }],
    });
    businessAccountIds.push(account.id);

    expect(account.name).toBe("Acme Retail");
    expect(account.discountTiers).toEqual([{ minOrdersPerMonth: 10, discountPercent: 5 }]);

    const count = await businessService.getMonthlyOrderCountForBusinessAccount(account.id);
    expect(count).toBe(0);
  });

  it("computes a real, live monthly order count from members' actual orders", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const account = await businessService.createBusinessAccount({ name: "Volume Test Co" });
    businessAccountIds.push(account.id);

    const member1 = await createTestCustomer("business-member1");
    userIds.push(member1.userId);
    customerProfileIds.push(member1.customerProfileId);
    const member2 = await createTestCustomer("business-member2");
    userIds.push(member2.userId);
    customerProfileIds.push(member2.customerProfileId);

    await businessService.addMember(account.id, member1.customerProfileId, adminUserId);
    await businessService.addMember(account.id, member2.customerProfileId, adminUserId);

    const order1 = await createTestOrder(member1.customerProfileId);
    orderIds.push(order1.id);
    const order2 = await createTestOrder(member2.customerProfileId);
    orderIds.push(order2.id);
    const canceledOrder = await createTestOrder(member1.customerProfileId, { status: "CANCELED" });
    orderIds.push(canceledOrder.id);

    // A non-member's orders must not count toward this business's volume.
    const outsider = await createTestCustomer("business-outsider");
    userIds.push(outsider.userId);
    customerProfileIds.push(outsider.customerProfileId);
    const outsiderOrder = await createTestOrder(outsider.customerProfileId);
    orderIds.push(outsiderOrder.id);

    const count = await businessService.getMonthlyOrderCountForBusinessAccount(account.id);
    expect(count).toBe(2); // order1 + order2, not the canceled one or the outsider's
  });

  it("addMember flips accountType to BUSINESS; removeMember flips it back to PERSONAL", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const account = await businessService.createBusinessAccount({ name: "Membership Test Co" });
    businessAccountIds.push(account.id);

    const member = await createTestCustomer("business-membership");
    userIds.push(member.userId);
    customerProfileIds.push(member.customerProfileId);

    const added = await businessService.addMember(account.id, member.customerProfileId, adminUserId);
    expect(added.businessAccountId).toBe(account.id);
    expect(added.accountType).toBe("BUSINESS");

    const removed = await businessService.removeMember(member.customerProfileId, adminUserId);
    expect(removed.businessAccountId).toBeNull();
    expect(removed.accountType).toBe("PERSONAL");
  });

  it("rejects removing a customer who isn't a member of any business account", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const notAMember = await createTestCustomer("business-not-a-member");
    userIds.push(notAMember.userId);
    customerProfileIds.push(notAMember.customerProfileId);

    await expect(businessService.removeMember(notAMember.customerProfileId, adminUserId)).rejects.toThrow();
  });

  it("updateBusinessAccountTiers replaces the tier list", async () => {
    if (!dbReachable) return console.warn("Skipping — DB unreachable");

    const account = await businessService.createBusinessAccount({
      name: "Tier Update Co",
      discountTiers: [{ minOrdersPerMonth: 10, discountPercent: 5 }],
    });
    businessAccountIds.push(account.id);

    const updated = await businessService.updateBusinessAccountTiers(account.id, [
      { minOrdersPerMonth: 20, discountPercent: 8 },
      { minOrdersPerMonth: 50, discountPercent: 15 },
    ]);
    expect(updated.discountTiers).toEqual([
      { minOrdersPerMonth: 20, discountPercent: 8 },
      { minOrdersPerMonth: 50, discountPercent: 15 },
    ]);
  });
});
