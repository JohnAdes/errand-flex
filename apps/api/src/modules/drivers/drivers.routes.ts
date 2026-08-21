import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { db, schema } from "../../db";
import * as driversService from "./drivers.service";
import { NotFoundError } from "../../lib/errors";

async function getDriverId(userId: string) {
  const driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.userId, userId) });
  if (!driver) throw new NotFoundError("Driver", userId);
  return driver.id;
}

const documentSchema = z.object({
  docType: z.enum(["LICENSE", "INSURANCE", "REGISTRATION"]),
  fileRef: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

const vehicleSchema = z.object({
  type: z.enum(["SEDAN", "VAN"]),
  plate: z.string().min(1),
  capacityWeightKg: z.number().positive(),
  capacityVolumeL: z.number().positive(),
});

export async function driversRoutes(app: FastifyInstance) {
  // GET /v1/drivers/me — status + vehicles + documents, so the app knows
  // whether to show onboarding or the normal home screen.
  app.get("/v1/drivers/me", { preHandler: [requireAuth, requireRole("DRIVER")] }, async (req) => {
    const driverId = await getDriverId(req.auth!.userId);
    return driversService.getMyProfile(driverId);
  });

  // POST /v1/drivers/me/documents
  app.post("/v1/drivers/me/documents", { preHandler: [requireAuth, requireRole("DRIVER")] }, async (req, reply) => {
    const body = documentSchema.parse(req.body);
    const driverId = await getDriverId(req.auth!.userId);
    const doc = await driversService.addDocument(
      driverId,
      body.docType,
      body.fileRef,
      body.expiresAt ? new Date(body.expiresAt) : undefined
    );
    reply.status(201).send(doc);
  });

  // POST /v1/drivers/me/vehicles
  app.post("/v1/drivers/me/vehicles", { preHandler: [requireAuth, requireRole("DRIVER")] }, async (req, reply) => {
    const body = vehicleSchema.parse(req.body);
    const driverId = await getDriverId(req.auth!.userId);
    const vehicle = await driversService.addVehicle(driverId, body);
    reply.status(201).send(vehicle);
  });

  // GET /v1/drivers/me/earnings
  app.get("/v1/drivers/me/earnings", { preHandler: [requireAuth, requireRole("DRIVER")] }, async (req) => {
    const driverId = await getDriverId(req.auth!.userId);
    return driversService.getDriverEarnings(driverId);
  });
}
