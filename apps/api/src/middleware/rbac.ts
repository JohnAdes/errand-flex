import type { FastifyRequest, FastifyReply } from "fastify";
import type { UserRole } from "@courier/shared-types";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

/**
 * Server-side role check. Every mutating/sensitive route in this codebase
 * declares its allowed roles explicitly via this factory — the admin portal's
 * nav-hiding is a UX convenience only and must never be the actual authorization
 * boundary (per the security model in 02-architecture.md §11).
 */
export function requireRole(...allowed: UserRole[]) {
  return async function (req: FastifyRequest, _reply: FastifyReply) {
    if (!req.auth) throw new UnauthorizedError();
    if (!allowed.includes(req.auth.role)) {
      throw new ForbiddenError(`Requires one of roles: ${allowed.join(", ")}`);
    }
  };
}
