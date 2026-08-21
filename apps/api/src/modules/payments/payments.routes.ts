import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import * as paymentsService from "./payments.service";
import * as payoutsService from "./payouts.service";

export async function paymentsRoutes(app: FastifyInstance) {
  const financeRoles = ["FINANCE", "OPS_MANAGER", "SUPER_ADMIN"] as const;

  // GET /v1/admin/payments — closes the "administrators manage payments" gap.
  app.get(
    "/v1/admin/payments",
    { preHandler: [requireAuth, requireRole(...financeRoles)] },
    async (req) => {
      const query = z.object({ status: z.string().optional() }).parse(req.query);
      return paymentsService.listPayments(query.status);
    }
  );

  // POST /v1/admin/payouts/run — batches a driver's pending earnings into one paid payout.
  app.post(
    "/v1/admin/payouts/run",
    { preHandler: [requireAuth, requireRole(...financeRoles)] },
    async (req, reply) => {
      const body = z
        .object({ driverId: z.string().uuid(), periodStart: z.string().datetime(), periodEnd: z.string().datetime() })
        .parse(req.body);
      const payout = await payoutsService.runPayoutBatch(
        body.driverId,
        new Date(body.periodStart),
        new Date(body.periodEnd),
        req.auth!.userId
      );
      reply.status(201).send(payout);
    }
  );

  // GET /v1/admin/payouts
  app.get(
    "/v1/admin/payouts",
    { preHandler: [requireAuth, requireRole(...financeRoles)] },
    async (req) => {
      const query = z.object({ driverId: z.string().uuid().optional() }).parse(req.query);
      return payoutsService.listPayouts(query.driverId);
    }
  );
}
