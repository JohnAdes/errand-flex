import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { requireIdempotencyKey, withIdempotency } from "../../lib/idempotency";
import { db, schema } from "../../db";
import * as custodyService from "./custody.service";
import { NotFoundError } from "../../lib/errors";

async function getDriverId(userId: string) {
  const driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.userId, userId) });
  if (!driver) throw new NotFoundError("Driver", userId);
  return driver.id;
}

const pickupSchema = z.object({
  driverLocation: z.object({ lat: z.number(), lng: z.number() }),
  pickupLocation: z.object({ lat: z.number(), lng: z.number() }),
  driverSelfieRef: z.string().min(1),
  packagePhotoRefs: z.array(z.string()).min(1),
  senderName: z.string().min(1),
  senderSignatureRef: z.string().optional(),
  pinUsed: z.boolean().default(false),
  deviceId: z.string().optional(),
});

const deliverySchema = z.object({
  driverLocation: z.object({ lat: z.number(), lng: z.number() }),
  dropoffLocation: z.object({ lat: z.number(), lng: z.number() }),
  outcome: z.enum(["DELIVERED", "FAILED"]),
  podPhotoRef: z.string().optional(),
  recipientName: z.string().optional(),
  recipientSignatureRef: z.string().optional(),
  pinUsed: z.boolean().default(false),
  idVerified: z.boolean().default(false),
  contactless: z.boolean().default(false),
  failureReason: z.string().optional(),
});

export async function custodyRoutes(app: FastifyInstance) {
  // POST /v1/orders/:id/pickup/verify
  app.post(
    "/v1/orders/:id/pickup/verify",
    { preHandler: [requireAuth, requireRole("DRIVER")] },
    async (req, reply) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const { id } = req.params as { id: string };
      const body = pickupSchema.parse(req.body);
      const driverId = await getDriverId(req.auth!.userId);

      const { result: verification } = await withIdempotency(idempotencyKey, () =>
        custodyService.verifyPickup({
          orderId: id,
          driverId,
          driverLat: body.driverLocation.lat,
          driverLng: body.driverLocation.lng,
          pickupLat: body.pickupLocation.lat,
          pickupLng: body.pickupLocation.lng,
          driverSelfieRef: body.driverSelfieRef,
          packagePhotoRefs: body.packagePhotoRefs,
          senderName: body.senderName,
          senderSignatureRef: body.senderSignatureRef,
          pinUsed: body.pinUsed,
          deviceId: body.deviceId,
        })
      );

      reply.status(200).send(verification);
    }
  );

  // POST /v1/orders/:id/delivery/verify
  app.post(
    "/v1/orders/:id/delivery/verify",
    { preHandler: [requireAuth, requireRole("DRIVER")] },
    async (req, reply) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const { id } = req.params as { id: string };
      const body = deliverySchema.parse(req.body);
      const driverId = await getDriverId(req.auth!.userId);

      const { result: verification } = await withIdempotency(idempotencyKey, () =>
        custodyService.verifyDelivery({
          orderId: id,
          driverId,
          driverLat: body.driverLocation.lat,
          driverLng: body.driverLocation.lng,
          dropoffLat: body.dropoffLocation.lat,
          dropoffLng: body.dropoffLocation.lng,
          outcome: body.outcome,
          podPhotoRef: body.podPhotoRef,
          recipientName: body.recipientName,
          recipientSignatureRef: body.recipientSignatureRef,
          pinUsed: body.pinUsed,
          idVerified: body.idVerified,
          contactless: body.contactless,
          failureReason: body.failureReason,
        })
      );

      reply.status(200).send(verification);
    }
  );
}
