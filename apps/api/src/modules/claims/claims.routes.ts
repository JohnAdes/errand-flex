import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { getDriverId, getCustomerProfileId, assertOrderAccess } from "../../lib/orderAccess";
import * as claimsService from "./claims.service";

const createClaimSchema = z.object({
  type: z.enum(["DAMAGED", "LOST", "LATE", "WRONG_ITEM", "BILLING", "OTHER"]),
  description: z.string().min(1),
  evidenceRefs: z.array(z.string()).optional(),
});

export async function claimsRoutes(app: FastifyInstance) {
  const dispatchRoles = ["DISPATCHER", "OPS_MANAGER", "SUPER_ADMIN"] as const;

  // POST /v1/orders/:id/claims — filed by the customer who owns the order or
  // the driver who carried it.
  app.post(
    "/v1/orders/:id/claims",
    { preHandler: [requireAuth, requireRole("CUSTOMER", "DRIVER")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = createClaimSchema.parse(req.body);

      const claim = await claimsService.createClaim({
        orderId: id,
        actorUserId: req.auth!.userId,
        actorCustomerProfileId: req.auth!.role === "CUSTOMER" ? await getCustomerProfileId(req.auth!.userId) : undefined,
        actorDriverId: req.auth!.role === "DRIVER" ? await getDriverId(req.auth!.userId) : undefined,
        ...body,
      });
      reply.status(201).send(claim);
    }
  );

  // GET /v1/orders/:id/claims — owner (customer/driver) or dispatch staff.
  // Object-level authorization per role (see lib/orderAccess.ts) — this used
  // to only restrict CUSTOMER, so any DRIVER could read any order's claim
  // details, the same IDOR class fixed on GET /v1/orders/:id.
  app.get("/v1/orders/:id/claims", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    await assertOrderAccess(req, id);
    return claimsService.listClaimsForOrder(id);
  });

  // GET /v1/admin/claims — dispatcher review queue.
  app.get("/v1/admin/claims", { preHandler: [requireAuth, requireRole(...dispatchRoles)] }, async (req) => {
    const query = z.object({ status: z.string().optional() }).parse(req.query);
    return claimsService.listClaims(query.status);
  });

  // GET /v1/admin/claims/:id
  app.get("/v1/admin/claims/:id", { preHandler: [requireAuth, requireRole(...dispatchRoles)] }, async (req) => {
    const { id } = req.params as { id: string };
    return claimsService.getClaim(id);
  });

  // POST /v1/admin/claims/:id/resolve
  app.post(
    "/v1/admin/claims/:id/resolve",
    { preHandler: [requireAuth, requireRole(...dispatchRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          outcome: z.enum(["RESOLVED", "REJECTED"]),
          resolution: z.string().min(1),
          refundCents: z.number().int().positive().optional(),
        })
        .parse(req.body);
      return claimsService.resolveClaim(id, req.auth!.userId, body.outcome, body.resolution, body.refundCents);
    }
  );
}
