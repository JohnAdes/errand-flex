import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { getDriverId, assertOrderAccess } from "../../lib/orderAccess";
import * as trackingService from "./tracking.service";

export async function trackingRoutes(app: FastifyInstance) {
  // POST /v1/drivers/me/location — what a real driver app's background
  // location task would call periodically while an order is active.
  // Rate-limited stricter than the app default (02-architecture.md §11) —
  // the driver app pings every 15s (~4/min); 30/min per IP leaves headroom
  // for several drivers behind the same NAT without allowing a flood.
  app.post(
    "/v1/drivers/me/location",
    { preHandler: [requireAuth, requireRole("DRIVER")], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z.object({ lat: z.number(), lng: z.number(), orderId: z.string().uuid().optional() }).parse(req.body);
      const driverId = await getDriverId(req.auth!.userId);
      const event = await trackingService.recordDriverLocation(driverId, body.lat, body.lng, body.orderId);
      reply.status(201).send(event);
    }
  );

  // GET /v1/orders/:id/tracking — customer-facing "where is my order" view.
  // Object-level authorization per role (see lib/orderAccess.ts) — this used
  // to only restrict CUSTOMER, so any DRIVER (or other role) could view any
  // order's live location, the same IDOR class fixed on GET /v1/orders/:id.
  app.get("/v1/orders/:id/tracking", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    await assertOrderAccess(req, id);
    return trackingService.getOrderTracking(id);
  });
}
