import { and, eq, lt, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { recordAudit } from "../lib/audit";

/**
 * Driver-document-expiration sweep (02-architecture.md §7, "daily"). A
 * driver's license/insurance/registration document can carry an
 * `expiresAt`; nothing ever checked it before. This flips any document past
 * its expiry to `EXPIRED` so the admin driver-review queue and future
 * "require re-verification" gating (not built yet) have something real to
 * act on — documents with no `expiresAt` set are never touched.
 */
export async function runDriverDocumentExpirationSweep() {
  const now = new Date();
  const expiring = await db.query.driverDocuments.findMany({
    where: and(lt(schema.driverDocuments.expiresAt, now), ne(schema.driverDocuments.status, "EXPIRED")),
  });

  for (const doc of expiring) {
    await db.update(schema.driverDocuments).set({ status: "EXPIRED" }).where(eq(schema.driverDocuments.id, doc.id));
    await recordAudit(db, {
      actorId: null,
      action: "DRIVER_DOCUMENT_EXPIRED",
      entityType: "DriverDocument",
      entityId: doc.id,
      before: { status: doc.status },
      after: { status: "EXPIRED", driverId: doc.driverId },
    });
  }

  return { expiredCount: expiring.length };
}
