export interface QuoteInput {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  serviceLevel: "ECONOMY" | "STANDARD" | "PRIORITY" | "SCHEDULED";
  totalWeightKg: number;
  packageCount: number;
  fragile: boolean;
  highValue: boolean; // declaredValueCents above a threshold, decided by caller
  contactless: boolean;
  requestedAt: Date;
  /** Orders placed this calendar month by the requesting customer's business account, if any — resolved by the caller (pricing.routes.ts) via business.service.ts, not looked up inside the pure evaluator. Drives BUSINESS_VOLUME_DISCOUNT. */
  businessMonthlyOrderCount?: number;
  /** The business account's own negotiated discount tiers, if it has any — takes priority over the platform-default BUSINESS_VOLUME_DISCOUNT rule tiers. */
  businessDiscountTiers?: Array<{ minOrdersPerMonth: number; discountPercent: number }>;
}

export interface PriceLine {
  label: string;
  amountCents: number;
}

export interface QuoteCalcResult {
  totalCents: number;
  breakdown: PriceLine[];
  distanceKm: number;
}

// ---------- Data-driven pricing rules ----------
// Mirrors 02-architecture.md §10: a pricing_plan selects pricing_rules by
// scope, each rule contributes a named line item. `PricingRuleDef` is the
// in-memory shape the evaluator consumes, whether it came from the hard-coded
// defaults below or was parsed out of a `pricing_rules` DB row / a published
// `pricing_rule_versions.snapshot`.

export type PricingRuleType =
  | "BASE_FEE"
  | "DISTANCE"
  | "WEIGHT_SURCHARGE"
  | "PACKAGE_FEE"
  | "FRAGILE_SURCHARGE"
  | "HIGH_VALUE_SURCHARGE"
  | "AFTER_HOURS_SURCHARGE"
  | "CONTACTLESS_DISCOUNT"
  | "SERVICE_LEVEL_MULTIPLIER"
  | "BUSINESS_VOLUME_DISCOUNT"
  | "MIN_CHARGE";

export interface PricingRuleParams {
  BASE_FEE: { amountCents: number };
  DISTANCE: { centsPerKm: number };
  WEIGHT_SURCHARGE: { thresholdKg: number; centsPerKgOver: number };
  PACKAGE_FEE: { centsPerAdditionalPackage: number };
  FRAGILE_SURCHARGE: { amountCents: number };
  HIGH_VALUE_SURCHARGE: { amountCents: number };
  AFTER_HOURS_SURCHARGE: { amountCents: number; startHour: number; endHour: number };
  CONTACTLESS_DISCOUNT: { amountCents: number };
  SERVICE_LEVEL_MULTIPLIER: { multipliers: Record<QuoteInput["serviceLevel"], number> };
  BUSINESS_VOLUME_DISCOUNT: { tiers: Array<{ minOrdersPerMonth: number; discountPercent: number }> };
  MIN_CHARGE: { minCents: number };
}

// A real discriminated union (not a generic-parameterized interface) so
// `switch (rule.ruleType)` in the evaluator narrows `rule.params` correctly.
export type PricingRuleDef = {
  [K in PricingRuleType]: { id?: string; ruleType: K; params: PricingRuleParams[K]; priority: number };
}[PricingRuleType];
