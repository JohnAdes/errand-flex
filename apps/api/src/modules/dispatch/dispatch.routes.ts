import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { requireIdempotencyKey, withIdempotency } from "../../lib/idempotency";
import { db, schema } from "../../db";
import * as dispatchService from "./dispatch.service";
import * as batchingService from "./batching.service";
import { NotFoundError } from "../../lib/errors";

async function getDriverId(userId: string) {
  const driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.userId, userId) });
  if (!driver) throw new NotFoundError("Driver", userId);
  return driver.id;
}

const createOfferSchema = z.object({
  orderId: z.string().uuid(),
  payoutCents: z.number().int().positive(),
});

const createBatchOfferSchema = z.object({
  payoutCents: z.number().int().positive(),
});

export async function dispatchRoutes(app: FastifyInstance) {
  const dispatchRoles = ["DISPATCHER", "OPS_MANAGER", "SUPER_ADMIN"] as const;

  // ---------- Route batching (02-architecture.md §9) ----------

  // POST /v1/internal/dispatch/batches/suggest — normally a scheduled
  // background job; exposed as a triggerable internal endpoint for the same
  // reason /v1/internal/dispatch/offer is (no job queue wired up here).
  app.post(
    "/v1/internal/dispatch/batches/suggest",
    { preHandler: [requireAuth, requireRole(...dispatchRoles)] },
    async (_req, reply) => {
      const created = await batchingService.suggestRouteBatches();
      reply.status(201).send(created);
    }
  );

  // GET /v1/admin/dispatch/batches — dispatcher review queue
  app.get(
    "/v1/admin/dispatch/batches",
    { preHandler: [requireAuth, requireRole(...dispatchRoles)] },
    async (req) => {
      const query = z.object({ status: z.string().optional() }).parse(req.query);
      return batchingService.listRouteBatches(query.status);
    }
  );

  // GET /v1/admin/dispatch/batches/:id
  app.get(
    "/v1/admin/dispatch/batches/:id",
    { preHandler: [requireAuth, requireRole(...dispatchRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      return batchingService.getRouteBatch(id);
    }
  );

  // POST /v1/admin/dispatch/batches/:id/approve
  app.post(
    "/v1/admin/dispatch/batches/:id/approve",
    { preHandler: [requireAuth, requireRole(...dispatchRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      return batchingService.approveRouteBatch(id, req.auth!.userId);
    }
  );

  // POST /v1/admin/dispatch/batches/:id/reject
  app.post(
    "/v1/admin/dispatch/batches/:id/reject",
    { preHandler: [requireAuth, requireRole(...dispatchRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      return batchingService.rejectRouteBatch(id, req.auth!.userId);
    }
  );

  // POST /v1/internal/dispatch/batches/:id/offer — offers an APPROVED batch
  // to the top-ranked candidate driver as a single multi-order offer.
  app.post(
    "/v1/internal/dispatch/batches/:id/offer",
    { preHandler: [requireAuth, requireRole(...dispatchRoles)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = createBatchOfferSchema.parse(req.body);
      const offer = await dispatchService.createBatchOfferRound(id, body.payoutCents);
      reply.status(201).send(offer);
    }
  );

  // POST /v1/internal/dispatch/offer — normally triggered by a background job
  // when an order enters SEARCHING_FOR_DRIVER, exposed here as an admin/internal
  // endpoint so it's triggerable without wiring up the full job queue.
  app.post(
    "/v1/internal/dispatch/offer",
    { preHandler: [requireAuth, requireRole("DISPATCHER", "OPS_MANAGER", "SUPER_ADMIN")] },
    async (req, reply) => {
      const body = createOfferSchema.parse(req.body);
      const offer = await dispatchService.createOfferRound(body.orderId, body.payoutCents);
      reply.status(201).send(offer);
    }
  );

  // POST /v1/driver-offers/:id/accept — the concurrency-critical endpoint.
  // Rate-limited stricter than the app default (02-architecture.md §11)
  // but generously enough that a legitimate burst of concurrent accept
  // attempts from the same IP (e.g. a manual concurrency smoke test) isn't
  // itself throttled — the atomic-UPDATE guarantee in acceptOffer() is what
  // actually needs to hold under that burst, not this limiter.
  app.post(
    "/v1/driver-offers/:id/accept",
    { preHandler: [requireAuth, requireRole("DRIVER")], config: { rateLimit: { max: 50, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const { id } = req.params as { id: string };
      const driverId = await getDriverId(req.auth!.userId);
      const { result: offer } = await withIdempotency(idempotencyKey, () => dispatchService.acceptOffer(id, driverId));
      reply.status(200).send(offer);
    }
  );

  // POST /v1/driver-offers/:id/decline
  app.post(
    "/v1/driver-offers/:id/decline",
    { preHandler: [requireAuth, requireRole("DRIVER")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const driverId = await getDriverId(req.auth!.userId);
      const result = await dispatchService.declineOffer(id, driverId);
      reply.status(200).send(result);
    }
  );

  // GET /v1/drivers/me/offers — the driver app's polling endpoint for
  // pending offers. A production system would push these via FCM instead of
  // polling (02-architecture.md §9), but polling is a fine, honest starting
  // point for a scaffold that doesn't have push notification infra wired up.
  app.get(
    "/v1/drivers/me/offers",
    { preHandler: [requireAuth, requireRole("DRIVER")] },
    async (req) => {
      const driverId = await getDriverId(req.auth!.userId);
      return dispatchService.listPendingOffersForDriver(driverId);
    }
  );

  // POST /v1/drivers/me/online — go online/offline
  app.post(
    "/v1/drivers/me/online",
    { preHandler: [requireAuth, requireRole("DRIVER")] },
    async (req, reply) => {
      const body = z.object({ online: z.boolean() }).parse(req.body);
      const driverId = await getDriverId(req.auth!.userId);
      const driver = await dispatchService.setDriverOnlineStatus(driverId, body.online);
      reply.status(200).send(driver);
    }
  );
}
