import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { db, schema } from "../../db";
import { NotFoundError } from "../../lib/errors";
import * as trackingService from "./tracking.service";

async function getDriverId(userId: string) {
  const driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.userId, userId) });
  if (!driver) throw new NotFoundError("Driver", userId);
  return driver.id;
}

async function getCustomerProfileId(userId: string) {
  const profile = await db.query.customerProfiles.findFirst({ where: eq(schema.customerProfiles.userId, userId) });
  if (!profile) throw new NotFoundError("CustomerProfile", userId);
  return profile.id;
}

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
  app.get("/v1/orders/:id/tracking", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    if (req.auth!.role === "CUSTOMER") {
      const customerProfileId = await getCustomerProfileId(req.auth!.userId);
      return trackingService.getOrderTracking(id, customerProfileId);
    }
    return trackingService.getOrderTracking(id);
  });
}
