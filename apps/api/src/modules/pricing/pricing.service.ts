import { desc, eq } from "drizzle-orm";
import { db, schema } from "../../db";
import { env } from "../../env";
import { ValidationError, NotFoundError, ConflictError } from "../../lib/errors";
import { haversineMeters } from "../../lib/geo";
import type { QuoteInput, QuoteCalcResult, PriceLine, PricingRuleDef, PricingRuleType } from "./pricing.types";

/**
 * Distance calculation placeholder.
 *
 * The architecture spec calls for routing/distance calls to go through a
 * mapping-provider abstraction (Mapbox/Google/etc.) so the provider can be
 * swapped later (02-architecture.md §4, §9). This starter kit has no mapping
 * API key configured, so it falls back to a straight-line haversine distance
 * (lib/geo.ts, shared with custody.service.ts's GPS-radius check) with a
 * fixed road-distance fudge factor on top. Replace `estimateDistanceKm` with
 * a real call to your chosen provider's distance-matrix API before relying on
 * this for real pricing — straight-line distance under-charges on anything
 * that isn't a direct route (rivers, highways, one-way systems, etc).
 */
export function estimateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const straightLineKm = haversineMeters(lat1, lng1, lat2, lng2) / 1000;
  const ROAD_DISTANCE_FUDGE_FACTOR = 1.3;
  return straightLineKm * ROAD_DISTANCE_FUDGE_FACTOR;
}

/**
 * The rule set a brand-new install (or any quote request that can't resolve
 * a published pricing-rule-version from the database) falls back to, so
 * quotes work out of the box. Numerically identical to the old hard-coded
 * constants this replaced — see git history / README for provenance.
 */
export const DEFAULT_PRICING_RULES: PricingRuleDef[] = [
  { ruleType: "BASE_FEE", priority: 0, params: { amountCents: 500 } },
  { ruleType: "DISTANCE", priority: 10, params: { centsPerKm: 120 } },
  { ruleType: "WEIGHT_SURCHARGE", priority: 20, params: { thresholdKg: 5, centsPerKgOver: 50 } },
  { ruleType: "PACKAGE_FEE", priority: 30, params: { centsPerAdditionalPackage: 150 } },
  { ruleType: "FRAGILE_SURCHARGE", priority: 40, params: { amountCents: 300 } },
  { ruleType: "HIGH_VALUE_SURCHARGE", priority: 50, params: { amountCents: 500 } },
  { ruleType: "AFTER_HOURS_SURCHARGE", priority: 60, params: { amountCents: 400, startHour: 7, endHour: 21 } },
  { ruleType: "CONTACTLESS_DISCOUNT", priority: 70, params: { amountCents: 0 } },
  {
    ruleType: "SERVICE_LEVEL_MULTIPLIER",
    priority: 80,
    params: { multipliers: { ECONOMY: 0.85, STANDARD: 1.0, PRIORITY: 1.4, SCHEDULED: 0.95 } },
  },
  {
    ruleType: "BUSINESS_VOLUME_DISCOUNT",
    priority: 85,
    params: {
      tiers: [
        { minOrdersPerMonth: 20, discountPercent: 5 },
        { minOrdersPerMonth: 50, discountPercent: 10 },
        { minOrdersPerMonth: 150, discountPercent: 15 },
      ],
    },
  },
  { ruleType: "MIN_CHARGE", priority: 90, params: { minCents: 600 } },
];

const ADDITIVE_RULE_TYPES: PricingRuleType[] = [
  "BASE_FEE",
  "DISTANCE",
  "WEIGHT_SURCHARGE",
  "PACKAGE_FEE",
  "FRAGILE_SURCHARGE",
  "HIGH_VALUE_SURCHARGE",
  "AFTER_HOURS_SURCHARGE",
  "CONTACTLESS_DISCOUNT",
];

/** Evaluates one additive rule against a quote request; returns null when the rule's condition doesn't apply. */
function evaluateAdditiveRule(rule: PricingRuleDef, input: QuoteInput, distanceKm: number): PriceLine | null {
  switch (rule.ruleType) {
    case "BASE_FEE":
      return { label: "Base pickup fee", amountCents: rule.params.amountCents };
    case "DISTANCE":
      return { label: "Distance charge", amountCents: Math.round(distanceKm * rule.params.centsPerKm) };
    case "WEIGHT_SURCHARGE":
      if (input.totalWeightKg <= rule.params.thresholdKg) return null;
      return {
        label: "Weight surcharge",
        amountCents: Math.round((input.totalWeightKg - rule.params.thresholdKg) * rule.params.centsPerKgOver),
      };
    case "PACKAGE_FEE":
      if (input.packageCount <= 1) return null;
      return {
        label: `Additional package fee (${input.packageCount - 1})`,
        amountCents: (input.packageCount - 1) * rule.params.centsPerAdditionalPackage,
      };
    case "FRAGILE_SURCHARGE":
      if (!input.fragile) return null;
      return { label: "Fragile item surcharge", amountCents: rule.params.amountCents };
    case "HIGH_VALUE_SURCHARGE":
      if (!input.highValue) return null;
      return { label: "High-value item surcharge", amountCents: rule.params.amountCents };
    case "AFTER_HOURS_SURCHARGE": {
      const hour = input.requestedAt.getHours();
      const isAfterHours = hour < rule.params.startHour || hour >= rule.params.endHour;
      if (!isAfterHours) return null;
      return { label: "After-hours surcharge", amountCents: rule.params.amountCents };
    }
    case "CONTACTLESS_DISCOUNT":
      if (!input.contactless || rule.params.amountCents <= 0) return null;
      return { label: "Contactless delivery discount", amountCents: -rule.params.amountCents };
    default:
      return null;
  }
}

/**
 * Calculates a quote from a rule set. Pure and synchronous — no DB access —
 * so it stays trivially unit-testable. `rules` defaults to
 * `DEFAULT_PRICING_RULES`; `createQuote` below is what actually resolves the
 * live, admin-configured rule set from the database and passes it in here.
 */
export function calculateQuote(input: QuoteInput, rules: PricingRuleDef[] = DEFAULT_PRICING_RULES): QuoteCalcResult {
  const distanceKm = estimateDistanceKm(input.pickupLat, input.pickupLng, input.dropoffLat, input.dropoffLng);

  const lines: PriceLine[] = [];
  const additiveRules = rules
    .filter((r) => ADDITIVE_RULE_TYPES.includes(r.ruleType))
    .sort((a, b) => a.priority - b.priority);

  for (const rule of additiveRules) {
    const line = evaluateAdditiveRule(rule, input, distanceKm);
    if (line) lines.push(line);
  }

  const subtotal = lines.reduce((sum, l) => sum + l.amountCents, 0);

  const serviceLevelRule = rules.find((r) => r.ruleType === "SERVICE_LEVEL_MULTIPLIER");
  const multiplier = serviceLevelRule?.params.multipliers[input.serviceLevel] ?? 1;
  const serviceLevelAdjustment = Math.round(subtotal * (multiplier - 1));
  if (serviceLevelAdjustment !== 0) {
    lines.push({ label: `${input.serviceLevel} service adjustment`, amountCents: serviceLevelAdjustment });
  }

  // Closes the "business delivery volume" pricing gap: a percentage discount
  // off the additive subtotal, gated on how many orders the customer's
  // business account has placed this calendar month (resolved by the caller
  // — see QuoteInput.businessMonthlyOrderCount — never looked up in here,
  // keeping this function pure/DB-free). A business account's own negotiated
  // `discountTiers` (business.service.ts) take priority over the platform's
  // default BUSINESS_VOLUME_DISCOUNT rule tiers when the caller supplies
  // them via QuoteInput.businessDiscountTiers — per-business rates fall back
  // to the admin-configured default only when a business has none set.
  const businessDiscountRule = rules.find((r) => r.ruleType === "BUSINESS_VOLUME_DISCOUNT");
  const monthlyOrderCount = input.businessMonthlyOrderCount ?? 0;
  const businessTiers =
    input.businessDiscountTiers && input.businessDiscountTiers.length > 0
      ? input.businessDiscountTiers
      : businessDiscountRule?.params.tiers;
  const applicableTier = businessTiers
    ?.filter((t) => monthlyOrderCount >= t.minOrdersPerMonth)
    .sort((a, b) => b.discountPercent - a.discountPercent)[0];
  const businessDiscountAdjustment = applicableTier ? -Math.round((subtotal * applicableTier.discountPercent) / 100) : 0;
  if (businessDiscountAdjustment !== 0) {
    lines.push({
      label: `Business volume discount (${applicableTier!.discountPercent}%)`,
      amountCents: businessDiscountAdjustment,
    });
  }

  let total = subtotal + serviceLevelAdjustment + businessDiscountAdjustment;

  const minChargeRule = rules.find((r) => r.ruleType === "MIN_CHARGE");
  const minCents = minChargeRule?.params.minCents ?? 0;
  if (total < minCents) {
    lines.push({ label: "Minimum charge adjustment", amountCents: minCents - total });
    total = minCents;
  }

  return { totalCents: total, breakdown: lines, distanceKm };
}

/**
 * Resolves the rule set a new quote should be evaluated against: the rules
 * snapshotted into the most recently published `pricing_rule_versions` row.
 * Publishing (see `publishPricingPlanVersion` below) is what promotes edits
 * made to the live-editable `pricing_rules` table into an immutable,
 * quote-referenceable version — editing a rule never retroactively changes a
 * quote/order that already snapshotted an earlier version
 * (02-architecture.md §10).
 */
async function resolveActiveRules(): Promise<{ rules: PricingRuleDef[]; versionId: string | null }> {
  const [latestVersion] = await db
    .select()
    .from(schema.pricingRuleVersions)
    .orderBy(desc(schema.pricingRuleVersions.publishedAt))
    .limit(1);

  const snapshotRules = (latestVersion?.snapshot as any)?.rules as PricingRuleDef[] | undefined;
  if (latestVersion && Array.isArray(snapshotRules) && snapshotRules.length > 0) {
    return { rules: snapshotRules, versionId: latestVersion.id };
  }

  return { rules: DEFAULT_PRICING_RULES, versionId: latestVersion?.id ?? null };
}

/**
 * Persists a quote, snapshotting a pricing-rule-version row so the exact
 * calculation is reproducible even if the underlying rule set changes later
 * (business rule from 01-product-specification.md §7).
 */
export async function createQuote(input: QuoteInput) {
  if (input.totalWeightKg <= 0) throw new ValidationError("totalWeightKg must be positive");
  if (input.packageCount <= 0) throw new ValidationError("packageCount must be at least 1");

  const { rules, versionId } = await resolveActiveRules();
  const calc = calculateQuote(input, rules);

  // Ensure there's at least a plan/version to reference — in a fully wired
  // system this would look up the plan matching the request's zone/service-
  // level scope (see admin pricing-plan endpoints in admin.routes.ts). This
  // bootstraps a default one on a brand-new install so quotes work out of
  // the box; see seed.ts for the normal path (a seeded, published plan).
  let pricingRuleVersionId = versionId;
  if (!pricingRuleVersionId) {
    const [plan] = await db
      .insert(schema.pricingPlans)
      .values({ name: "Default MVP Plan", scope: {}, active: true })
      .returning();
    const [version] = await db
      .insert(schema.pricingRuleVersions)
      .values({
        pricingPlanId: plan.id,
        versionNo: 1,
        publishedBy: "system-bootstrap",
        snapshot: { rules: DEFAULT_PRICING_RULES },
      })
      .returning();
    pricingRuleVersionId = version.id;
  }

  const expiresAt = new Date(Date.now() + env.QUOTE_EXPIRY_MINUTES * 60_000);

  const [quote] = await db
    .insert(schema.quotes)
    .values({
      breakdown: calc.breakdown as any,
      totalCents: calc.totalCents,
      expiresAt,
      pricingRuleVersionId,
    })
    .returning();

  return { quote, calc };
}

export async function getQuote(id: string) {
  const quote = await db.query.quotes.findFirst({ where: eq(schema.quotes.id, id) });
  if (!quote) throw new NotFoundError("Quote", id);
  return quote;
}

// ---------- Admin: pricing plans & rules (draft/editable) ----------
// pricing_plans / pricing_rules are the live-editable working set an admin
// edits via CRUD below; nothing here affects real quotes until
// `publishPricingPlanVersion` snapshots it into an immutable version.

export async function listPricingPlans() {
  return db.select().from(schema.pricingPlans).orderBy(desc(schema.pricingPlans.id));
}

export async function createPricingPlan(input: { name: string; scope?: Record<string, unknown> }) {
  const [plan] = await db
    .insert(schema.pricingPlans)
    .values({ name: input.name, scope: input.scope ?? {}, active: true })
    .returning();
  return plan;
}

export async function listPricingRules(pricingPlanId: string) {
  const plan = await db.query.pricingPlans.findFirst({ where: eq(schema.pricingPlans.id, pricingPlanId) });
  if (!plan) throw new NotFoundError("PricingPlan", pricingPlanId);
  return db.query.pricingRules.findMany({
    where: eq(schema.pricingRules.pricingPlanId, pricingPlanId),
    orderBy: (rules, { asc }) => [asc(rules.priority)],
  });
}

export async function createPricingRule(
  pricingPlanId: string,
  input: { ruleType: PricingRuleType; params: Record<string, unknown>; priority: number }
) {
  const plan = await db.query.pricingPlans.findFirst({ where: eq(schema.pricingPlans.id, pricingPlanId) });
  if (!plan) throw new NotFoundError("PricingPlan", pricingPlanId);

  const [rule] = await db
    .insert(schema.pricingRules)
    .values({ pricingPlanId, ruleType: input.ruleType, params: input.params, priority: input.priority })
    .returning();
  return rule;
}

export async function updatePricingRule(
  ruleId: string,
  input: { params?: Record<string, unknown>; priority?: number }
) {
  const existing = await db.query.pricingRules.findFirst({ where: eq(schema.pricingRules.id, ruleId) });
  if (!existing) throw new NotFoundError("PricingRule", ruleId);

  const [updated] = await db
    .update(schema.pricingRules)
    .set({
      params: input.params ?? existing.params,
      priority: input.priority ?? existing.priority,
    })
    .where(eq(schema.pricingRules.id, ruleId))
    .returning();
  return updated;
}

export async function deletePricingRule(ruleId: string) {
  const deleted = await db.delete(schema.pricingRules).where(eq(schema.pricingRules.id, ruleId)).returning();
  if (deleted.length === 0) throw new NotFoundError("PricingRule", ruleId);
  return { deleted: true };
}

export async function listPricingRuleVersions(pricingPlanId: string) {
  return db.query.pricingRuleVersions.findMany({
    where: eq(schema.pricingRuleVersions.pricingPlanId, pricingPlanId),
    orderBy: (versions, { desc }) => [desc(versions.versionNo)],
  });
}

/**
 * Snapshots the plan's current draft rules into a new immutable
 * `pricing_rule_versions` row. This is the only thing that makes rule edits
 * take effect for real quotes — see `resolveActiveRules` above.
 */
export async function publishPricingPlanVersion(pricingPlanId: string, publishedBy: string) {
  return db.transaction(async (tx) => {
    const plan = await tx.query.pricingPlans.findFirst({ where: eq(schema.pricingPlans.id, pricingPlanId) });
    if (!plan) throw new NotFoundError("PricingPlan", pricingPlanId);

    const draftRules = await tx.query.pricingRules.findMany({
      where: eq(schema.pricingRules.pricingPlanId, pricingPlanId),
      orderBy: (rules, { asc }) => [asc(rules.priority)],
    });
    if (draftRules.length === 0) {
      throw new ConflictError("This plan has no rules to publish — add at least one rule first");
    }

    const rules: PricingRuleDef[] = draftRules.map((r) => ({
      id: r.id,
      ruleType: r.ruleType as PricingRuleType,
      params: r.params as any,
      priority: r.priority,
    }));

    const [lastVersion] = await tx
      .select()
      .from(schema.pricingRuleVersions)
      .where(eq(schema.pricingRuleVersions.pricingPlanId, pricingPlanId))
      .orderBy(desc(schema.pricingRuleVersions.versionNo))
      .limit(1);
    const nextVersionNo = (lastVersion?.versionNo ?? 0) + 1;

    const [version] = await tx
      .insert(schema.pricingRuleVersions)
      .values({ pricingPlanId, versionNo: nextVersionNo, publishedBy, snapshot: { rules } })
      .returning();

    return version;
  });
}
