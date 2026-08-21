import { schema } from "../db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type TxClient = NodePgDatabase<typeof schema>;

/**
 * Every state-changing action in the system must write an audit log row.
 * This helper is intentionally tiny and dependency-free so there's no excuse
 * to skip calling it — pass the same transaction handle you used for the
 * actual mutation so the audit row commits atomically with the change it
 * describes (if the transaction rolls back, so does the audit entry).
 */
export async function recordAudit(
  tx: TxClient,
  params: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  }
) {
  await tx.insert(schema.auditLogs).values({
    actorId: params.actorId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    before: params.before === undefined ? null : (params.before as any),
    after: params.after === undefined ? null : (params.after as any),
  });
}
