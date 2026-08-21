import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { env } from "../env";
import { db, schema } from "../db";
import { UnauthorizedError } from "../lib/errors";
import { getFirebaseAuth } from "../lib/firebaseAdmin";
import type { UserRole } from "@courier/shared-types";

export interface AuthContext {
  userId: string;
  role: UserRole;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Local JWT verification — the default (AUTH_PROVIDER=local, see env.ts).
 * Exported (not just used internally by requireAuth) so the rate-limit
 * plugin's keyGenerator (app.ts) can decode the token for per-user limiting
 * — that hook runs ahead of every route's requireAuth preHandler, so it
 * can't rely on req.auth being set yet and needs to do this same decode
 * itself.
 */
export function verifyToken(token: string): AuthContext {
  const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; role: UserRole };
  return { userId: payload.sub, role: payload.role };
}

/**
 * Real Firebase ID token verification, activated by AUTH_PROVIDER=firebase.
 * A Firebase ID token proves *identity* (a Firebase UID) but carries no
 * opinion on this app's roles, so the local `users` row — looked up by
 * `firebaseUid` — is still the source of truth for `role`. A verified token
 * with no matching local row means the client authenticated with Firebase
 * but never completed `POST /v1/auth/link-firebase-account` (auth.service.ts) —
 * treated as unauthorized here rather than auto-provisioning a row, since
 * auto-assigning a role from an unauthenticated claim would let a caller
 * pick their own role.
 */
async function verifyFirebaseToken(token: string): Promise<AuthContext> {
  const decoded = await getFirebaseAuth().verifyIdToken(token);
  const user = await db.query.users.findFirst({ where: eq(schema.users.firebaseUid, decoded.uid) });
  if (!user) {
    throw new UnauthorizedError("No local account linked to this Firebase user — complete registration first");
  }
  return { userId: user.id, role: user.role };
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }
  const token = header.slice("Bearer ".length);
  try {
    req.auth = env.AUTH_PROVIDER === "firebase" ? await verifyFirebaseToken(token) : verifyToken(token);
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError("Invalid or expired token");
  }
}

/**
 * Best-effort per-user key for the rate-limit plugin (app.ts) — not a trust
 * boundary, just a bucketing key, so under AUTH_PROVIDER=firebase this reads
 * the token's `user_id`/`sub` claim without verifying its signature (a real
 * signature check on every request, just for rate-limit bucketing, would add
 * a network round-trip to Google's JWKS endpoint on the hot path). A forged
 * token here only earns the attacker their own wrong bucket — requireAuth
 * still does full verification before anything trusts the identity.
 */
export function extractRateLimitUserId(token: string): string | null {
  if (env.AUTH_PROVIDER === "firebase") {
    const decoded = jwt.decode(token) as { user_id?: string; sub?: string } | null;
    return decoded?.user_id ?? decoded?.sub ?? null;
  }
  try {
    return verifyToken(token).userId;
  } catch {
    return null;
  }
}
