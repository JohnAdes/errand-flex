import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { env } from "../env";
import { UnauthorizedError } from "../lib/errors";
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
 * ⚠️ MVP AUTH IMPLEMENTATION — LOCAL JWT, NOT FIREBASE ⚠️
 *
 * The architecture spec (02-architecture.md §1) calls for Firebase Authentication
 * as the identity provider, with the backend validating Firebase ID tokens on every
 * request. That requires a real Firebase project + service account credentials,
 * which this starter kit doesn't have. So this codebase runs on a self-contained
 * local JWT scheme instead, so it's runnable out of the box.
 *
 * TO SWITCH TO FIREBASE: replace the body of `verifyToken` below with a call to
 * `admin.auth().verifyIdToken(token)` (firebase-admin SDK), and change
 * `auth.service.ts` to stop issuing/checking passwords locally — Firebase becomes
 * the source of truth for authentication, this API just validates its tokens and
 * looks up the corresponding `users` row by `firebaseUid` (add that column back to
 * the users table — it was deliberately omitted here since there's no Firebase
 * project to key against yet).
 */
function verifyToken(token: string): AuthContext {
  const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; role: UserRole };
  return { userId: payload.sub, role: payload.role };
}

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }
  const token = header.slice("Bearer ".length);
  try {
    req.auth = verifyToken(token);
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
}
