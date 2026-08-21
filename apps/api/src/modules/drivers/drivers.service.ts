import { eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { NotFoundError } from "../../lib/errors";
import { recordAudit } from "../../lib/audit";

export async function addDocument(driverId: string, docType: string, fileRef: string, expiresAt?: Date) {
  const [doc] = await db
    .insert(schema.driverDocuments)
    .values({ driverId, docType, fileRef, expiresAt, status: "PENDING" })
    .returning();
  return doc;
}

export async function addVehicle(
  driverId: string,
  data: { type: "SEDAN" | "VAN"; plate: string; capacityWeightKg: number; capacityVolumeL: number }
) {
  const [vehicle] = await db
    .insert(schema.vehicles)
    .values({ driverId, ...data })
    .returning();
  return vehicle;
}

export async function approveDriver(driverId: string, actorId: string) {
  return db.transaction(async (tx) => {
    const driver = await tx.query.drivers.findFirst({ where: eq(schema.drivers.id, driverId) });
    if (!driver) throw new NotFoundError("Driver", driverId);

    const [updated] = await tx.update(schema.drivers).set({ status: "APPROVED" }).where(eq(schema.drivers.id, driverId)).returning();

    await recordAudit(tx, {
      actorId,
      action: "DRIVER_APPROVED",
      entityType: "Driver",
      entityId: driverId,
      before: { status: driver.status },
      after: { status: "APPROVED" },
    });

    return updated;
  });
}

export async function suspendDriver(driverId: string, actorId: string, reason: string) {
  return db.transaction(async (tx) => {
    const driver = await tx.query.drivers.findFirst({ where: eq(schema.drivers.id, driverId) });
    if (!driver) throw new NotFoundError("Driver", driverId);

    const [updated] = await tx
      .update(schema.drivers)
      .set({ status: "SUSPENDED", onlineStatus: false })
      .where(eq(schema.drivers.id, driverId))
      .returning();

    await recordAudit(tx, {
      actorId,
      action: "DRIVER_SUSPENDED",
      entityType: "Driver",
      entityId: driverId,
      before: { status: driver.status },
      after: { status: "SUSPENDED", reason },
    });

    return updated;
  });
}

export async function listDriversForReview() {
  const drivers = await db.query.drivers.findMany({
    where: eq(schema.drivers.status, "PENDING"),
    with: { user: true, documents: true, vehicles: true },
    orderBy: (drivers, { asc }) => [asc(drivers.createdAt)],
  });

  // SECURITY: strip passwordHash before this ever leaves the service layer.
  // Drizzle's `with: { user: true }` pulls every column on `users`, including
  // passwordHash — there's no column-projection shorthand as clean as
  // Prisma's `select` here, so the safe pattern is: fetch, then explicitly
  // scrub sensitive fields before returning. This was caught by actually
  // calling the endpoint and inspecting the response, not by reading the
  // code — a reminder that "with: { user: true }" is exactly the kind of
  // thing that looks fine in isolation and leaks credentials in practice.
  return drivers.map((driver) => ({
    ...driver,
    user: driver.user ? sanitizeUser(driver.user) : null,
  }));
}

function sanitizeUser<T extends { passwordHash?: string | null }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash, ...safe } = user;
  return safe;
}

export async function getDriverEarnings(driverId: string) {
  return db.query.driverEarnings.findMany({
    where: eq(schema.driverEarnings.driverId, driverId),
    orderBy: (earnings, { desc }) => [desc(earnings.createdAt)],
  });
}

/**
 * A driver's own profile — status, vehicles, documents. Closes a real gap:
 * previously nothing let the driver app find out whether it should show
 * onboarding (PENDING, no vehicle/documents) or the normal home screen
 * (APPROVED). Without this, a newly-registered driver had no way to ever
 * discover they needed to submit anything.
 */
export async function getMyProfile(driverId: string) {
  const driver = await db.query.drivers.findFirst({
    where: eq(schema.drivers.id, driverId),
    with: { vehicles: true, documents: true },
  });
  if (!driver) throw new NotFoundError("Driver", driverId);
  return driver;
}
