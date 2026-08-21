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
    actorId: normalizeActorId(params.actorId),
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    before: params.before === undefined ? null : (params.before as any),
    after: params.after === undefined ? null : (params.after as any),
  });
}

/**
 * audit_logs.actor_id is a real users.id FK — pseudo-actors like
 * "system:dispatch" (scheduled jobs, internal processes) or "driver:<id>"
 * (custody verification, which authenticates a driver but not a `users`
 * row) aren't UUIDs and would fail that FK constraint, so they're recorded
 * as a null actor instead. Centralized here after review found this same
 * check copy-pasted at three separate call sites and already drifted: only
 * one of the three stripped the "driver:" prefix, the other two only
 * checked "system:".
 */
function normalizeActorId(actorId: string | null): string | null {
  if (actorId === null) return null;
  if (actorId.startsWith("system:") || actorId.startsWith("driver:")) return null;
  return actorId;
}
