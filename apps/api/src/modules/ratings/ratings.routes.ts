import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { db, schema } from "../../db";
import { NotFoundError } from "../../lib/errors";
import * as ratingsService from "./ratings.service";

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

const submitRatingSchema = z.object({
  value: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});

export async function ratingsRoutes(app: FastifyInstance) {
  // POST /v1/orders/:id/ratings — a customer rates the driver who carried
  // their order, or the driver rates the customer. Which one is inferred
  // from the caller's role, not a client-supplied field.
  app.post(
    "/v1/orders/:id/ratings",
    { preHandler: [requireAuth, requireRole("CUSTOMER", "DRIVER")] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = submitRatingSchema.parse(req.body);

      const rating = await ratingsService.submitRating({
        orderId: id,
        actorUserId: req.auth!.userId,
        raterType: req.auth!.role === "CUSTOMER" ? "CUSTOMER" : "DRIVER",
        value: body.value,
        comment: body.comment,
        actorCustomerProfileId: req.auth!.role === "CUSTOMER" ? await getCustomerProfileId(req.auth!.userId) : undefined,
        actorDriverId: req.auth!.role === "DRIVER" ? await getDriverId(req.auth!.userId) : undefined,
      });
      reply.status(201).send(rating);
    }
  );

  // GET /v1/orders/:id/ratings
  app.get("/v1/orders/:id/ratings", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    return ratingsService.listRatingsForOrder(id);
  });
}
