import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { DEFAULT_PRICING_RULES } from "../modules/pricing/pricing.service";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function upsertUserByEmail(email: string, values: Omit<typeof schema.users.$inferInsert, "email">) {
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) return existing;
  const [user] = await db
    .insert(schema.users)
    .values({ email, ...values })
    .returning();
  return user;
}

async function main() {
  console.log("Seeding...");

  const existingArea = await db.query.serviceAreas.findFirst({ where: eq(schema.serviceAreas.name, "Dallas–Fort Worth") });
  const serviceArea =
    existingArea ??
    (
      await db
        .insert(schema.serviceAreas)
        .values({ name: "Dallas–Fort Worth", timezone: "America/Chicago", marketStatus: "ACTIVE" })
        .returning()
    )[0];
  console.log(`Service area: ${serviceArea.name}`);

  const existingPlan = await db.query.pricingPlans.findFirst({ where: eq(schema.pricingPlans.name, "Default MVP Plan") });
  const plan =
    existingPlan ??
    (
      await db
        .insert(schema.pricingPlans)
        .values({ name: "Default MVP Plan", scope: { serviceAreaId: serviceArea.id }, active: true })
        .returning()
    )[0];

  const existingRules = await db.query.pricingRules.findMany({ where: eq(schema.pricingRules.pricingPlanId, plan.id) });
  if (existingRules.length === 0) {
    await db.insert(schema.pricingRules).values(
      DEFAULT_PRICING_RULES.map((r) => ({
        pricingPlanId: plan.id,
        ruleType: r.ruleType,
        params: r.params,
        priority: r.priority,
      }))
    );
  }

  const existingVersion = await db.query.pricingRuleVersions.findFirst({
    where: eq(schema.pricingRuleVersions.pricingPlanId, plan.id),
  });
  if (!existingVersion) {
    await db.insert(schema.pricingRuleVersions).values({
      pricingPlanId: plan.id,
      versionNo: 1,
      publishedBy: "seed-script",
      snapshot: { rules: DEFAULT_PRICING_RULES },
    });
  }

  const customerPasswordHash = await bcrypt.hash("password123", 10);
  const customer = await upsertUserByEmail("casey@example.com", {
    passwordHash: customerPasswordHash,
    role: "CUSTOMER",
    emailVerified: true,
  });
  const customerProfile = await db.query.customerProfiles.findFirst({ where: eq(schema.customerProfiles.userId, customer.id) });
  if (!customerProfile) {
    await db.insert(schema.customerProfiles).values({ userId: customer.id, displayName: "Casey Customer" });
  }
  console.log(`Customer: ${customer.email} / password123`);

  const driverPasswordHash = await bcrypt.hash("password123", 10);
  const driverUser = await upsertUserByEmail("marcus@example.com", {
    passwordHash: driverPasswordHash,
    role: "DRIVER",
    emailVerified: true,
  });
  let driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.userId, driverUser.id) });
  if (!driver) {
    const [newDriver] = await db
      .insert(schema.drivers)
      .values({ userId: driverUser.id, status: "APPROVED", onlineStatus: true })
      .returning();
    driver = newDriver;
    await db.insert(schema.vehicles).values({
      driverId: driver.id,
      type: "SEDAN",
      plate: "DFW-1234",
      capacityWeightKg: 200,
      capacityVolumeL: 400,
    });
  }
  console.log(`Driver (approved & online): ${driverUser.email} / password123`);

  const adminPasswordHash = await bcrypt.hash("password123", 10);
  const admin = await upsertUserByEmail("owen@example.com", {
    passwordHash: adminPasswordHash,
    role: "SUPER_ADMIN",
    emailVerified: true,
  });
  const adminUser = await db.query.adminUsers.findFirst({ where: eq(schema.adminUsers.userId, admin.id) });
  if (!adminUser) {
    await db.insert(schema.adminUsers).values({ userId: admin.id, department: "Operations" });
  }
  console.log(`Admin: ${admin.email} / password123`);

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
