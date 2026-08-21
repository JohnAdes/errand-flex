import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { requireIdempotencyKey, getCachedResult, cacheResult } from "../../lib/idempotency";
import { db, schema } from "../../db";
import * as ordersService from "./orders.service";
import * as paymentsService from "../payments/payments.service";
import { getAcceptedOfferForOrder } from "../dispatch/dispatch.service";
import { NotFoundError, ForbiddenError } from "../../lib/errors";

const addressSchema = z.object({
  line1: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  postal: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
});

const createOrderSchema = z.object({
  quoteId: z.string().uuid(),
  serviceLevel: z.enum(["ECONOMY", "STANDARD", "PRIORITY", "SCHEDULED"]),
  pickup: addressSchema,
  dropoff: addressSchema.extend({
    recipientName: z.string().min(1),
    recipientPhone: z.string().min(1),
  }),
  packages: z
    .array(
      z.object({
        category: z.enum(["DOCUMENTS", "SMALL_PARCEL", "MEDIUM_PARCEL", "LARGE_PARCEL", "FOOD", "ELECTRONICS", "OTHER"]),
        weightKg: z.number().positive(),
        quantity: z.number().int().positive().default(1),
        declaredValueCents: z.number().int().nonnegative().default(0),
        fragile: z.boolean().default(false),
        perishable: z.boolean().default(false),
        confidential: z.boolean().default(false),
      })
    )
    .min(1),
  deliveryInstructions: z.string().optional(),
  contactlessDelivery: z.boolean().default(false),
});

async function getCustomerProfileId(userId: string) {
  const profile = await db.query.customerProfiles.findFirst({ where: eq(schema.customerProfiles.userId, userId) });
  if (!profile) throw new NotFoundError("CustomerProfile", userId);
  return profile.id;
}

async function getDriverId(userId: string) {
  const driver = await db.query.drivers.findFirst({ where: eq(schema.drivers.userId, userId) });
  if (!driver) throw new NotFoundError("Driver", userId);
  return driver.id;
}

export async function orderRoutes(app: FastifyInstance) {
  // POST /v1/orders — idempotency-key required per API spec (02-architecture.md §6)
  app.post("/v1/orders", { preHandler: [requireAuth, requireRole("CUSTOMER")] }, async (req, reply) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const cached = getCachedResult(idempotencyKey);
    if (cached) {
      reply.status(200).send(cached);
      return;
    }

    const body = createOrderSchema.parse(req.body);
    const customerProfileId = await getCustomerProfileId(req.auth!.userId);

    const order = await ordersService.createOrder({
      actorUserId: req.auth!.userId,
      customerProfileId,
      quoteId: body.quoteId,
      serviceLevel: body.serviceLevel,
      pickup: body.pickup,
      dropoff: body.dropoff,
      packages: body.packages,
      deliveryInstructions: body.deliveryInstructions,
      contactlessDelivery: body.contactlessDelivery,
    });

    cacheResult(idempotencyKey, order);
    reply.status(201).send(order);
  });

  // POST /v1/orders/:id/pay — authorizes payment (via the pluggable
  // PaymentProvider, see payment.provider.ts) and advances the order into
  // the dispatch pipeline. Idempotency-key required since this hits a
  // payment provider — a retried request must never double-authorize.
  app.post(
    "/v1/orders/:id/pay",
    { preHandler: [requireAuth, requireRole("CUSTOMER")] },
    async (req, reply) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const cached = getCachedResult(idempotencyKey);
      if (cached) {
        reply.status(200).send(cached);
        return;
      }
      const { id } = req.params as { id: string };
      const payment = await paymentsService.authorizePayment(id, req.auth!.userId);
      cacheResult(idempotencyKey, payment);
      reply.status(201).send(payment);
    }
  );

  // GET /v1/orders — customer's own order history
  app.get("/v1/orders", { preHandler: [requireAuth, requireRole("CUSTOMER")] }, async (req) => {
    const customerProfileId = await getCustomerProfileId(req.auth!.userId);
    return ordersService.listOrdersForCustomer(customerProfileId);
  });

  // GET /v1/orders/:id
  app.get("/v1/orders/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    // Object-level authorization per role — found broken by a code review
    // pass: this used to only special-case CUSTOMER, so any other
    // authenticated role (DRIVER included, not just dispatch/ops/admin
    // staff as the old comment claimed) fell through to the unrestricted
    // `getOrder(id)` call and could view any order's full PII.
    if (req.auth!.role === "CUSTOMER") {
      const customerProfileId = await getCustomerProfileId(req.auth!.userId);
      return ordersService.getOrder(id, customerProfileId);
    }
    if (req.auth!.role === "DRIVER") {
      const driverId = await getDriverId(req.auth!.userId);
      const accepted = await getAcceptedOfferForOrder(db, id);
      if (!accepted || accepted.driverId !== driverId) {
        throw new ForbiddenError("You do not have access to this order");
      }
      return ordersService.getOrder(id);
    }
    // Remaining roles (DISPATCHER, OPS_MANAGER, SUPER_ADMIN, FINANCE) are
    // back-office staff with legitimate unrestricted read access.
    return ordersService.getOrder(id);
  });

  // POST /v1/orders/:id/cancel
  app.post(
    "/v1/orders/:id/cancel",
    { preHandler: [requireAuth, requireRole("CUSTOMER", "DISPATCHER", "OPS_MANAGER", "SUPER_ADMIN")] },
    async (req, reply) => {
      requireIdempotencyKey(req);
      const { id } = req.params as { id: string };
      const requesterCustomerProfileId = req.auth!.role === "CUSTOMER" ? await getCustomerProfileId(req.auth!.userId) : undefined;
      const order = await ordersService.cancelOrder(id, req.auth!.userId, requesterCustomerProfileId);
      reply.status(200).send(order);
    }
  );
}
