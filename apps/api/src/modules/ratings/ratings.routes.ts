import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { getDriverId, getCustomerProfileId, assertOrderAccess } from "../../lib/orderAccess";
import * as ratingsService from "./ratings.service";

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

  // GET /v1/orders/:id/ratings — had zero object-level authorization
  // (any authenticated user of any role could read any order's ratings);
  // now uses the same per-role check as tracking/claims (lib/orderAccess.ts).
  app.get("/v1/orders/:id/ratings", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    await assertOrderAccess(req, id);
    return ratingsService.listRatingsForOrder(id);
  });
}
