import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { db, schema } from "../../db";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";

export interface DiscountTier {
  minOrdersPerMonth: number;
  discountPercent: number;
}

export async function createBusinessAccount(input: { name: string; contactEmail?: string; discountTiers?: DiscountTier[] }) {
  const [account] = await db
    .insert(schema.businessAccounts)
    .values({ name: input.name, contactEmail: input.contactEmail, discountTiers: input.discountTiers ?? [] })
    .returning();
  return account;
}

export async function updateBusinessAccountTiers(id: string, discountTiers: DiscountTier[]) {
  const existing = await db.query.businessAccounts.findFirst({ where: eq(schema.businessAccounts.id, id) });
  if (!existing) throw new NotFoundError("BusinessAccount", id);
  const [updated] = await db
    .update(schema.businessAccounts)
    .set({ discountTiers })
    .where(eq(schema.businessAccounts.id, id))
    .returning();
  return updated;
}

/** Orders placed this calendar month (UTC) by any member of the business account, excluding canceled ones — the live signal the volume-discount pricing rule evaluates against. */
export async function getMonthlyOrderCountForBusinessAccount(businessAccountId: string): Promise<number> {
  const members = await db.query.customerProfiles.findMany({
    where: eq(schema.customerProfiles.businessAccountId, businessAccountId),
  });
  if (members.length === 0) return 0;

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const orders = await db.query.orders.findMany({
    where: and(
      inArray(schema.orders.customerProfileId, members.map((m) => m.id)),
      gte(schema.orders.createdAt, startOfMonth),
      ne(schema.orders.status, "CANCELED")
    ),
  });
  return orders.length;
}

export async function listBusinessAccounts() {
  const accounts = await db.select().from(schema.businessAccounts);
  return Promise.all(
    accounts.map(async (account) => ({
      ...account,
      monthlyOrderCount: await getMonthlyOrderCountForBusinessAccount(account.id),
    }))
  );
}

export async function getBusinessAccount(id: string) {
  const account = await db.query.businessAccounts.findFirst({
    where: eq(schema.businessAccounts.id, id),
    with: { members: true },
  });
  if (!account) throw new NotFoundError("BusinessAccount", id);
  const monthlyOrderCount = await getMonthlyOrderCountForBusinessAccount(id);
  return { ...account, monthlyOrderCount };
}

export async function addMember(businessAccountId: string, customerProfileId: string, actorUserId: string) {
  const account = await db.query.businessAccounts.findFirst({ where: eq(schema.businessAccounts.id, businessAccountId) });
  if (!account) throw new NotFoundError("BusinessAccount", businessAccountId);
  const profile = await db.query.customerProfiles.findFirst({ where: eq(schema.customerProfiles.id, customerProfileId) });
  if (!profile) throw new NotFoundError("CustomerProfile", customerProfileId);

  const [updated] = await db
    .update(schema.customerProfiles)
    .set({ businessAccountId, accountType: "BUSINESS" })
    .where(eq(schema.customerProfiles.id, customerProfileId))
    .returning();

  await recordAudit(db, {
    actorId: actorUserId,
    action: "BUSINESS_ACCOUNT_MEMBER_ADDED",
    entityType: "BusinessAccount",
    entityId: businessAccountId,
    after: { customerProfileId },
  });

  return updated;
}

export async function removeMember(customerProfileId: string, actorUserId: string) {
  const profile = await db.query.customerProfiles.findFirst({ where: eq(schema.customerProfiles.id, customerProfileId) });
  if (!profile) throw new NotFoundError("CustomerProfile", customerProfileId);
  if (!profile.businessAccountId) throw new ValidationError("This customer is not a member of any business account");

  const businessAccountId = profile.businessAccountId;
  const [updated] = await db
    .update(schema.customerProfiles)
    .set({ businessAccountId: null, accountType: "PERSONAL" })
    .where(eq(schema.customerProfiles.id, customerProfileId))
    .returning();

  await recordAudit(db, {
    actorId: actorUserId,
    action: "BUSINESS_ACCOUNT_MEMBER_REMOVED",
    entityType: "BusinessAccount",
    entityId: businessAccountId,
    after: { customerProfileId },
  });

  return updated;
}
