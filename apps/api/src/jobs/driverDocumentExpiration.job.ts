import { and, inArray, lt, ne } from "drizzle-orm";
import { db, schema } from "../db";

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

  return db.transaction(async (tx) => {
    const toExpire = await tx.query.driverDocuments.findMany({
      where: and(lt(schema.driverDocuments.expiresAt, now), ne(schema.driverDocuments.status, "EXPIRED")),
    });
    if (toExpire.length === 0) return { expiredCount: 0 };

    // Bulk UPDATE + one batched audit insert instead of the previous
    // per-document UPDATE-then-audit-insert loop — found by review to be an
    // N+1 pattern (2 queries per document) in a job that sweeps potentially
    // every driver's documents platform-wide, daily.
    await tx
      .update(schema.driverDocuments)
      .set({ status: "EXPIRED" })
      .where(inArray(schema.driverDocuments.id, toExpire.map((d) => d.id)));

    await tx.insert(schema.auditLogs).values(
      toExpire.map((doc) => ({
        actorId: null,
        action: "DRIVER_DOCUMENT_EXPIRED",
        entityType: "DriverDocument",
        entityId: doc.id,
        before: { status: doc.status } as any,
        after: { status: "EXPIRED", driverId: doc.driverId } as any,
      }))
    );

    return { expiredCount: toExpire.length };
  });
}
