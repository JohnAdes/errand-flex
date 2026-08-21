import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { db, schema } from "../../db";
import * as pricingService from "./pricing.service";
import { getMonthlyOrderCountForBusinessAccount } from "../business/business.service";

const quoteRequestSchema = z.object({
  pickup: z.object({ lat: z.number(), lng: z.number() }),
  dropoff: z.object({ lat: z.number(), lng: z.number() }),
  serviceLevel: z.enum(["ECONOMY", "STANDARD", "PRIORITY", "SCHEDULED"]),
  totalWeightKg: z.number().positive(),
  packageCount: z.number().int().positive(),
  fragile: z.boolean().default(false),
  highValue: z.boolean().default(false),
  contactless: z.boolean().default(false),
});

export async function pricingRoutes(app: FastifyInstance) {
  // POST /v1/quotes — customer-facing, server-authoritative pricing calc.
  app.post(
    "/v1/quotes",
    { preHandler: [requireAuth, requireRole("CUSTOMER")] },
    async (req, reply) => {
      const body = quoteRequestSchema.parse(req.body);

      // Resolves the business-volume-discount signal (see pricing.service.ts
      // BUSINESS_VOLUME_DISCOUNT) — a no-op lookup for the common case of a
      // personal account with no business_account_id.
      const customerProfile = await db.query.customerProfiles.findFirst({
        where: eq(schema.customerProfiles.userId, req.auth!.userId),
      });
      let businessMonthlyOrderCount: number | undefined;
      let businessDiscountTiers: Array<{ minOrdersPerMonth: number; discountPercent: number }> | undefined;
      if (customerProfile?.businessAccountId) {
        businessMonthlyOrderCount = await getMonthlyOrderCountForBusinessAccount(customerProfile.businessAccountId);
        const businessAccount = await db.query.businessAccounts.findFirst({
          where: eq(schema.businessAccounts.id, customerProfile.businessAccountId),
        });
        businessDiscountTiers = businessAccount?.discountTiers as typeof businessDiscountTiers;
      }

      const { quote, calc } = await pricingService.createQuote({
        pickupLat: body.pickup.lat,
        pickupLng: body.pickup.lng,
        dropoffLat: body.dropoff.lat,
        dropoffLng: body.dropoff.lng,
        serviceLevel: body.serviceLevel,
        totalWeightKg: body.totalWeightKg,
        packageCount: body.packageCount,
        fragile: body.fragile,
        highValue: body.highValue,
        contactless: body.contactless,
        requestedAt: new Date(),
        businessMonthlyOrderCount,
        businessDiscountTiers,
      });

      reply.status(201).send({
        id: quote.id,
        totalCents: quote.totalCents,
        currency: quote.currency,
        breakdown: calc.breakdown,
        distanceKm: Math.round(calc.distanceKm * 10) / 10,
        expiresAt: quote.expiresAt,
        pricingRuleVersionId: quote.pricingRuleVersionId,
      });
    }
  );

  // GET /v1/quotes/:id
  app.get("/v1/quotes/:id", { preHandler: [requireAuth] }, async (req) => {
    const { id } = req.params as { id: string };
    return pricingService.getQuote(id);
  });
}
