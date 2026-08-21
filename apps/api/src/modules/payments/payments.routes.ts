import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { requireIdempotencyKey, withIdempotency } from "../../lib/idempotency";
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

  // POST /v1/admin/payouts/run — batches a driver's pending earnings into one
  // paid payout. Idempotency-key required, same as every other money-moving
  // endpoint (orders create/pay/cancel, custody verify) — previously missing
  // here, so a retried request had nothing stopping it from re-triggering
  // payouts.service.ts's double-payout race.
  app.post(
    "/v1/admin/payouts/run",
    { preHandler: [requireAuth, requireRole(...financeRoles)] },
    async (req, reply) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const body = z
        .object({ driverId: z.string().uuid(), periodStart: z.string().datetime(), periodEnd: z.string().datetime() })
        .parse(req.body);
      const { result: payout, replayed } = await withIdempotency(idempotencyKey, () =>
        payoutsService.runPayoutBatch(
          body.driverId,
          new Date(body.periodStart),
          new Date(body.periodEnd),
          req.auth!.userId
        )
      );
      reply.status(replayed ? 200 : 201).send(payout);
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
