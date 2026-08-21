import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { db, schema } from "../../db";
import * as driversService from "../drivers/drivers.service";
import * as pricingService from "../pricing/pricing.service";
import * as businessService from "../business/business.service";

export async function adminRoutes(app: FastifyInstance) {
  const opsRoles = ["OPS_MANAGER", "SUPER_ADMIN"] as const;
  const dispatchRoles = ["DISPATCHER", "OPS_MANAGER", "SUPER_ADMIN"] as const;

  // GET /v1/admin/drivers/pending
  app.get(
    "/v1/admin/drivers/pending",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async () => driversService.listDriversForReview()
  );

  // POST /v1/admin/drivers/:id/approve
  app.post(
    "/v1/admin/drivers/:id/approve",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const driver = await driversService.approveDriver(id, req.auth!.userId);
      reply.status(200).send(driver);
    }
  );

  // POST /v1/admin/drivers/:id/suspend
  app.post(
    "/v1/admin/drivers/:id/suspend",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({ reason: z.string().min(1) }).parse(req.body);
      const driver = await driversService.suspendDriver(id, req.auth!.userId, body.reason);
      reply.status(200).send(driver);
    }
  );

  // GET /v1/admin/orders — live ops view, filterable by status
  app.get(
    "/v1/admin/orders",
    { preHandler: [requireAuth, requireRole(...dispatchRoles)] },
    async (req) => {
      const query = z
        .object({ status: z.string().optional(), limit: z.coerce.number().max(200).default(50) })
        .parse(req.query);

      return db.query.orders.findMany({
        where: query.status ? eq(schema.orders.status, query.status as any) : undefined,
        orderBy: (orders, { desc }) => [desc(orders.createdAt)],
        limit: query.limit,
        with: { packages: true, stops: true },
      });
    }
  );

  // GET /v1/admin/reports/kpis — minimal KPI set from the full list in
  // 02-architecture.md / the delivery-plan reporting epic (E14). Extend with
  // the remaining KPIs (on-time rate, driver utilization, etc.) once enough
  // production data exists to make them meaningful.
  app.get(
    "/v1/admin/reports/kpis",
    { preHandler: [requireAuth, requireRole(...opsRoles, "FINANCE")] },
    async () => {
      const [totalOrdersResult, byStatus, activeDriversResult, revenueResult] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(schema.orders),
        db
          .select({ status: schema.orders.status, count: sql<number>`count(*)::int` })
          .from(schema.orders)
          .groupBy(schema.orders.status),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.drivers)
          .where(and(eq(schema.drivers.status, "APPROVED"), eq(schema.drivers.onlineStatus, true))),
        db
          .select({ total: sql<number>`coalesce(sum(${schema.orders.totalCents}), 0)::int` })
          .from(schema.orders)
          .where(eq(schema.orders.status, "DELIVERED")),
      ]);

      return {
        totalOrders: totalOrdersResult[0]?.count ?? 0,
        ordersByStatus: byStatus,
        activeDrivers: activeDriversResult[0]?.count ?? 0,
        totalRevenueCents: revenueResult[0]?.total ?? 0,
      };
    }
  );

  // GET /v1/admin/audit-logs
  app.get(
    "/v1/admin/audit-logs",
    { preHandler: [requireAuth, requireRole("OPS_MANAGER", "SUPER_ADMIN", "FINANCE")] },
    async (req) => {
      const query = z
        .object({ entityType: z.string().optional(), entityId: z.string().optional(), limit: z.coerce.number().max(200).default(100) })
        .parse(req.query);

      const conditions = [];
      if (query.entityType) conditions.push(eq(schema.auditLogs.entityType, query.entityType));
      if (query.entityId) conditions.push(eq(schema.auditLogs.entityId, query.entityId));

      return db
        .select()
        .from(schema.auditLogs)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(schema.auditLogs.occurredAt))
        .limit(query.limit);
    }
  );

  // ---------- Pricing plans & rules (02-architecture.md §10) ----------
  // Admin-facing CRUD over the live-editable draft rule set. None of this
  // affects real quotes until POST .../publish snapshots it into an
  // immutable pricing_rule_version — see pricing.service.ts.

  const pricingRuleParamsSchema = z.discriminatedUnion("ruleType", [
    z.object({ ruleType: z.literal("BASE_FEE"), params: z.object({ amountCents: z.number().int() }) }),
    z.object({ ruleType: z.literal("DISTANCE"), params: z.object({ centsPerKm: z.number().int() }) }),
    z.object({
      ruleType: z.literal("WEIGHT_SURCHARGE"),
      params: z.object({ thresholdKg: z.number().nonnegative(), centsPerKgOver: z.number().int() }),
    }),
    z.object({
      ruleType: z.literal("PACKAGE_FEE"),
      params: z.object({ centsPerAdditionalPackage: z.number().int() }),
    }),
    z.object({ ruleType: z.literal("FRAGILE_SURCHARGE"), params: z.object({ amountCents: z.number().int() }) }),
    z.object({ ruleType: z.literal("HIGH_VALUE_SURCHARGE"), params: z.object({ amountCents: z.number().int() }) }),
    z.object({
      ruleType: z.literal("AFTER_HOURS_SURCHARGE"),
      params: z.object({
        amountCents: z.number().int(),
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(0).max(23),
      }),
    }),
    z.object({ ruleType: z.literal("CONTACTLESS_DISCOUNT"), params: z.object({ amountCents: z.number().int() }) }),
    z.object({
      ruleType: z.literal("SERVICE_LEVEL_MULTIPLIER"),
      params: z.object({
        multipliers: z.object({
          ECONOMY: z.number().positive(),
          STANDARD: z.number().positive(),
          PRIORITY: z.number().positive(),
          SCHEDULED: z.number().positive(),
        }),
      }),
    }),
    z.object({
      ruleType: z.literal("BUSINESS_VOLUME_DISCOUNT"),
      params: z.object({
        tiers: z.array(z.object({ minOrdersPerMonth: z.number().int().positive(), discountPercent: z.number().min(0).max(100) })),
      }),
    }),
    z.object({ ruleType: z.literal("MIN_CHARGE"), params: z.object({ minCents: z.number().int().nonnegative() }) }),
  ]);

  const createPricingRuleSchema = z.intersection(
    pricingRuleParamsSchema,
    z.object({ priority: z.number().int().default(0) })
  );

  // GET /v1/admin/pricing/plans
  app.get("/v1/admin/pricing/plans", { preHandler: [requireAuth, requireRole(...opsRoles)] }, async () =>
    pricingService.listPricingPlans()
  );

  // POST /v1/admin/pricing/plans
  app.post(
    "/v1/admin/pricing/plans",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req, reply) => {
      const body = z.object({ name: z.string().min(1), scope: z.record(z.unknown()).optional() }).parse(req.body);
      const plan = await pricingService.createPricingPlan(body);
      reply.status(201).send(plan);
    }
  );

  // GET /v1/admin/pricing/plans/:id/rules
  app.get(
    "/v1/admin/pricing/plans/:id/rules",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      return pricingService.listPricingRules(id);
    }
  );

  // POST /v1/admin/pricing/plans/:id/rules
  app.post(
    "/v1/admin/pricing/plans/:id/rules",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = createPricingRuleSchema.parse(req.body);
      const rule = await pricingService.createPricingRule(id, body);
      reply.status(201).send(rule);
    }
  );

  // PATCH /v1/admin/pricing/rules/:id
  app.patch(
    "/v1/admin/pricing/rules/:id",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({ params: z.record(z.unknown()).optional(), priority: z.number().int().optional() })
        .parse(req.body);
      return pricingService.updatePricingRule(id, body);
    }
  );

  // DELETE /v1/admin/pricing/rules/:id
  app.delete(
    "/v1/admin/pricing/rules/:id",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      return pricingService.deletePricingRule(id);
    }
  );

  // GET /v1/admin/pricing/plans/:id/versions
  app.get(
    "/v1/admin/pricing/plans/:id/versions",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      return pricingService.listPricingRuleVersions(id);
    }
  );

  // POST /v1/admin/pricing/plans/:id/publish — snapshots the plan's current
  // draft rules into a new immutable version; this is what makes edits take
  // effect for real quotes.
  app.post(
    "/v1/admin/pricing/plans/:id/publish",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const version = await pricingService.publishPricingPlanVersion(id, req.auth!.userId);
      reply.status(201).send(version);
    }
  );

  // ---------- Business accounts ----------
  // Closes the "small business lacks affordable local logistics" gap's admin
  // side: a dedicated entity to group a business's staff accounts, see their
  // live monthly order volume, and let BUSINESS_VOLUME_DISCOUNT pricing react to it.

  const businessAccountTierSchema = z.object({
    minOrdersPerMonth: z.number().int().positive(),
    discountPercent: z.number().min(0).max(100),
  });

  // POST /v1/admin/business-accounts
  app.post(
    "/v1/admin/business-accounts",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req, reply) => {
      const body = z
        .object({ name: z.string().min(1), contactEmail: z.string().email().optional(), discountTiers: z.array(businessAccountTierSchema).optional() })
        .parse(req.body);
      const account = await businessService.createBusinessAccount(body);
      reply.status(201).send(account);
    }
  );

  // GET /v1/admin/business-accounts
  app.get(
    "/v1/admin/business-accounts",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async () => businessService.listBusinessAccounts()
  );

  // GET /v1/admin/business-accounts/:id
  app.get(
    "/v1/admin/business-accounts/:id",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      return businessService.getBusinessAccount(id);
    }
  );

  // PATCH /v1/admin/business-accounts/:id/discount-tiers
  app.patch(
    "/v1/admin/business-accounts/:id/discount-tiers",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = z.object({ discountTiers: z.array(businessAccountTierSchema) }).parse(req.body);
      return businessService.updateBusinessAccountTiers(id, body.discountTiers);
    }
  );

  // POST /v1/admin/business-accounts/:id/members
  app.post(
    "/v1/admin/business-accounts/:id/members",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z.object({ customerProfileId: z.string().uuid() }).parse(req.body);
      const profile = await businessService.addMember(id, body.customerProfileId, req.auth!.userId);
      reply.status(200).send(profile);
    }
  );

  // DELETE /v1/admin/business-accounts/members/:customerProfileId
  app.delete(
    "/v1/admin/business-accounts/members/:customerProfileId",
    { preHandler: [requireAuth, requireRole(...opsRoles)] },
    async (req) => {
      const { customerProfileId } = req.params as { customerProfileId: string };
      return businessService.removeMember(customerProfileId, req.auth!.userId);
    }
  );
}
