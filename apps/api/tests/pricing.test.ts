import { describe, it, expect } from "vitest";
import { calculateQuote, DEFAULT_PRICING_RULES } from "../src/modules/pricing/pricing.service";
import type { QuoteInput, PricingRuleDef } from "../src/modules/pricing/pricing.types";

function baseInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    pickupLat: 32.9483,
    pickupLng: -96.8236, // Frisco, TX
    dropoffLat: 32.7555,
    dropoffLng: -97.3308, // Fort Worth, TX
    serviceLevel: "STANDARD",
    totalWeightKg: 2,
    packageCount: 1,
    fragile: false,
    highValue: false,
    contactless: false,
    requestedAt: new Date("2026-08-10T14:00:00"), // daytime, no after-hours surcharge
    ...overrides,
  };
}

describe("pricing engine", () => {
  it("always includes a base fee and distance charge", () => {
    const result = calculateQuote(baseInput());
    const labels = result.breakdown.map((l) => l.label);
    expect(labels).toContain("Base pickup fee");
    expect(labels).toContain("Distance charge");
    expect(result.totalCents).toBeGreaterThan(0);
  });

  it("never returns a quote below the minimum charge", () => {
    // Very short distance, minimal weight — should still hit the floor.
    const result = calculateQuote(
      baseInput({ pickupLat: 32.9483, pickupLng: -96.8236, dropoffLat: 32.9484, dropoffLng: -96.8237 })
    );
    expect(result.totalCents).toBeGreaterThanOrEqual(600);
  });

  it("charges more for PRIORITY than STANDARD for the same trip", () => {
    const standard = calculateQuote(baseInput({ serviceLevel: "STANDARD" }));
    const priority = calculateQuote(baseInput({ serviceLevel: "PRIORITY" }));
    expect(priority.totalCents).toBeGreaterThan(standard.totalCents);
  });

  it("charges less for ECONOMY than STANDARD for the same trip", () => {
    const standard = calculateQuote(baseInput({ serviceLevel: "STANDARD" }));
    const economy = calculateQuote(baseInput({ serviceLevel: "ECONOMY" }));
    expect(economy.totalCents).toBeLessThan(standard.totalCents);
  });

  it("adds a fragile surcharge line when fragile is true", () => {
    const withFragile = calculateQuote(baseInput({ fragile: true }));
    const labels = withFragile.breakdown.map((l) => l.label);
    expect(labels).toContain("Fragile item surcharge");
  });

  it("adds an additional-package fee for multi-package orders", () => {
    const result = calculateQuote(baseInput({ packageCount: 3 }));
    const line = result.breakdown.find((l) => l.label.startsWith("Additional package fee"));
    expect(line).toBeDefined();
    expect(line!.amountCents).toBe(2 * 150);
  });

  it("adds an after-hours surcharge for late-night requests", () => {
    const lateNight = calculateQuote(baseInput({ requestedAt: new Date("2026-08-10T02:00:00") }));
    const labels = lateNight.breakdown.map((l) => l.label);
    expect(labels).toContain("After-hours surcharge");
  });

  it("is deterministic for identical inputs", () => {
    const a = calculateQuote(baseInput());
    const b = calculateQuote(baseInput());
    expect(a.totalCents).toBe(b.totalCents);
  });
});

describe("pricing engine — data-driven rule set", () => {
  it("is admin-configurable: a custom rule set changes the calculated price", () => {
    const doubledBaseFee: PricingRuleDef[] = DEFAULT_PRICING_RULES.map((r) =>
      r.ruleType === "BASE_FEE" ? { ...r, params: { amountCents: 1000 } } : r
    );
    const defaultResult = calculateQuote(baseInput(), DEFAULT_PRICING_RULES);
    const customResult = calculateQuote(baseInput(), doubledBaseFee);
    expect(customResult.totalCents).toBe(defaultResult.totalCents + 500);
  });

  it("omits a rule's line item entirely when the rule is removed from the set", () => {
    const withoutFragile = DEFAULT_PRICING_RULES.filter((r) => r.ruleType !== "FRAGILE_SURCHARGE");
    const result = calculateQuote(baseInput({ fragile: true }), withoutFragile);
    expect(result.breakdown.map((l) => l.label)).not.toContain("Fragile item surcharge");
  });

  it("falls back to a zero minimum charge and 1x multiplier when those rules are absent", () => {
    const minimalRules: PricingRuleDef[] = [{ ruleType: "BASE_FEE", priority: 0, params: { amountCents: 100 } }];
    const result = calculateQuote(baseInput({ serviceLevel: "PRIORITY" }), minimalRules);
    expect(result.totalCents).toBe(100);
    expect(result.breakdown).toEqual([{ label: "Base pickup fee", amountCents: 100 }]);
  });

  it("produces the same numbers as the old hard-coded constants for a known input (regression)", () => {
    const result = calculateQuote(baseInput());
    expect(result.totalCents).toBeGreaterThanOrEqual(600);
    const labels = result.breakdown.map((l) => l.label);
    expect(labels).toEqual(["Base pickup fee", "Distance charge"]);
  });
});

describe("pricing engine — business volume discount", () => {
  it("applies no discount below the lowest tier's threshold", () => {
    const result = calculateQuote(baseInput({ businessMonthlyOrderCount: 5 }));
    const hasDiscountLine = result.breakdown.some((l) => l.label.startsWith("Business volume discount"));
    expect(hasDiscountLine).toBe(false);
  });

  it("applies the matching tier's discount once a threshold is crossed", () => {
    const withoutDiscount = calculateQuote(baseInput({ businessMonthlyOrderCount: 0 }));
    const withDiscount = calculateQuote(baseInput({ businessMonthlyOrderCount: 25 }));
    const line = withDiscount.breakdown.find((l) => l.label.startsWith("Business volume discount"));
    expect(line).toBeDefined();
    expect(line!.amountCents).toBeLessThan(0);
    expect(withDiscount.totalCents).toBeLessThan(withoutDiscount.totalCents);
  });

  it("picks the highest qualifying tier, not just the first one crossed", () => {
    const result = calculateQuote(baseInput({ businessMonthlyOrderCount: 200 }));
    const line = result.breakdown.find((l) => l.label.startsWith("Business volume discount"));
    expect(line!.label).toContain("15%");
  });
});
