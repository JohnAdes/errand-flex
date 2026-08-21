"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";
import { useAuth } from "../../lib/auth-context";
import { api } from "../../lib/api";

const RULE_TYPES = [
  "BASE_FEE",
  "DISTANCE",
  "WEIGHT_SURCHARGE",
  "PACKAGE_FEE",
  "FRAGILE_SURCHARGE",
  "HIGH_VALUE_SURCHARGE",
  "AFTER_HOURS_SURCHARGE",
  "CONTACTLESS_DISCOUNT",
  "SERVICE_LEVEL_MULTIPLIER",
  "BUSINESS_VOLUME_DISCOUNT",
  "MIN_CHARGE",
] as const;

function defaultParamsFor(ruleType: string): Record<string, unknown> {
  switch (ruleType) {
    case "BASE_FEE":
    case "FRAGILE_SURCHARGE":
    case "HIGH_VALUE_SURCHARGE":
    case "CONTACTLESS_DISCOUNT":
      return { amountCents: 0 };
    case "DISTANCE":
      return { centsPerKm: 0 };
    case "WEIGHT_SURCHARGE":
      return { thresholdKg: 5, centsPerKgOver: 0 };
    case "PACKAGE_FEE":
      return { centsPerAdditionalPackage: 0 };
    case "AFTER_HOURS_SURCHARGE":
      return { amountCents: 0, startHour: 21, endHour: 7 };
    case "SERVICE_LEVEL_MULTIPLIER":
      return { multipliers: { ECONOMY: 1, STANDARD: 1, PRIORITY: 1, SCHEDULED: 1 } };
    case "BUSINESS_VOLUME_DISCOUNT":
      return { tiers: [] };
    case "MIN_CHARGE":
      return { minCents: 0 };
    default:
      return {};
  }
}

/** Renders (and edits) the params object for one rule, shaped to that rule's actual fields rather than a raw JSON blob. */
function RuleParamsForm({ ruleType, params, onChange }: { ruleType: string; params: any; onChange: (params: any) => void }) {
  const num = (label: string, key: string, step = 1) => (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="number"
        step={step}
        value={params[key] ?? 0}
        onChange={(e) => onChange({ ...params, [key]: Number(e.target.value) })}
        className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  );

  switch (ruleType) {
    case "BASE_FEE":
    case "FRAGILE_SURCHARGE":
    case "HIGH_VALUE_SURCHARGE":
    case "CONTACTLESS_DISCOUNT":
      return <div className="grid grid-cols-2 gap-2">{num("Amount (cents)", "amountCents")}</div>;
    case "DISTANCE":
      return <div className="grid grid-cols-2 gap-2">{num("Cents per km", "centsPerKm")}</div>;
    case "WEIGHT_SURCHARGE":
      return (
        <div className="grid grid-cols-2 gap-2">
          {num("Threshold (kg)", "thresholdKg", 0.1)}
          {num("Cents per kg over", "centsPerKgOver")}
        </div>
      );
    case "PACKAGE_FEE":
      return <div className="grid grid-cols-2 gap-2">{num("Cents per additional package", "centsPerAdditionalPackage")}</div>;
    case "AFTER_HOURS_SURCHARGE":
      return (
        <div className="grid grid-cols-3 gap-2">
          {num("Amount (cents)", "amountCents")}
          {num("After-hours start (hour, 0-23)", "startHour")}
          {num("After-hours end (hour, 0-23)", "endHour")}
        </div>
      );
    case "MIN_CHARGE":
      return <div className="grid grid-cols-2 gap-2">{num("Minimum charge (cents)", "minCents")}</div>;
    case "SERVICE_LEVEL_MULTIPLIER": {
      const multipliers = params.multipliers ?? {};
      return (
        <div className="grid grid-cols-4 gap-2">
          {(["ECONOMY", "STANDARD", "PRIORITY", "SCHEDULED"] as const).map((level) => (
            <label key={level} className="block">
              <span className="text-xs text-slate-500">{level}</span>
              <input
                type="number"
                step={0.05}
                value={multipliers[level] ?? 1}
                onChange={(e) => onChange({ multipliers: { ...multipliers, [level]: Number(e.target.value) } })}
                className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          ))}
        </div>
      );
    }
    case "BUSINESS_VOLUME_DISCOUNT": {
      const tiers: Array<{ minOrdersPerMonth: number; discountPercent: number }> = params.tiers ?? [];
      return (
        <div>
          {tiers.map((tier, i) => (
            <div key={i} className="mb-1 flex items-center gap-2">
              <input
                type="number"
                value={tier.minOrdersPerMonth}
                onChange={(e) => {
                  const next = [...tiers];
                  next[i] = { ...tier, minOrdersPerMonth: Number(e.target.value) };
                  onChange({ tiers: next });
                }}
                className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                placeholder="Min orders/mo"
              />
              <input
                type="number"
                value={tier.discountPercent}
                onChange={(e) => {
                  const next = [...tiers];
                  next[i] = { ...tier, discountPercent: Number(e.target.value) };
                  onChange({ tiers: next });
                }}
                className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                placeholder="Discount %"
              />
              <button onClick={() => onChange({ tiers: tiers.filter((_, j) => j !== i) })} className="text-xs text-red-600">
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ tiers: [...tiers, { minOrdersPerMonth: 20, discountPercent: 5 }] })}
            className="text-xs text-brand-600 hover:underline"
          >
            + Add tier
          </button>
        </div>
      );
    }
    default:
      return null;
  }
}

export default function PricingPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [newPlanName, setNewPlanName] = useState("");
  const [newRuleType, setNewRuleType] = useState<(typeof RULE_TYPES)[number]>("BASE_FEE");
  const [newRuleParams, setNewRuleParams] = useState<any>(defaultParamsFor("BASE_FEE"));
  const [newRulePriority, setNewRulePriority] = useState("0");
  const [actionError, setActionError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const loadPlans = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api.getPricingPlans(session.token);
      setPlans(data);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load pricing plans");
    }
  }, [session]);

  const loadPlanDetail = useCallback(
    async (planId: string) => {
      if (!session) return;
      try {
        const [rulesData, versionsData] = await Promise.all([
          api.getPricingRules(planId, session.token),
          api.getPricingVersions(planId, session.token),
        ]);
        setRules(rulesData);
        setVersions(versionsData);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Failed to load plan detail");
      }
    },
    [session]
  );

  useEffect(() => {
    if (!loading && !session) router.push("/login");
  }, [loading, session, router]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (selectedPlanId) loadPlanDetail(selectedPlanId);
  }, [selectedPlanId, loadPlanDetail]);

  async function handleCreatePlan() {
    if (!session || !newPlanName.trim()) return;
    try {
      const plan = await api.createPricingPlan({ name: newPlanName.trim() }, session.token);
      setNewPlanName("");
      await loadPlans();
      setSelectedPlanId(plan.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create plan");
    }
  }

  async function handleAddRule() {
    if (!session || !selectedPlanId) return;
    setActionError(null);
    try {
      await api.createPricingRule(
        selectedPlanId,
        { ruleType: newRuleType, params: newRuleParams, priority: parseInt(newRulePriority, 10) || 0 },
        session.token
      );
      await loadPlanDetail(selectedPlanId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to add rule");
    }
  }

  async function handleUpdateRule(ruleId: string, params: any, priority: number) {
    if (!session) return;
    setActionError(null);
    try {
      await api.updatePricingRule(ruleId, { params, priority }, session.token);
      if (selectedPlanId) await loadPlanDetail(selectedPlanId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update rule");
    }
  }

  async function handleDeleteRule(ruleId: string) {
    if (!session || !selectedPlanId) return;
    if (!window.confirm("Delete this rule from the draft?")) return;
    try {
      await api.deletePricingRule(ruleId, session.token);
      await loadPlanDetail(selectedPlanId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete rule");
    }
  }

  async function handlePublish() {
    if (!session || !selectedPlanId) return;
    setPublishing(true);
    setActionError(null);
    try {
      await api.publishPricingPlan(selectedPlanId, session.token);
      await loadPlanDetail(selectedPlanId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to publish — add at least one rule first");
    } finally {
      setPublishing(false);
    }
  }

  if (loading || !session) return null;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-2 text-2xl font-semibold text-slate-900">Pricing</h1>
        <p className="mb-6 text-sm text-slate-500">
          Edit a plan&apos;s draft rules, then Publish to snapshot them into an immutable version — quotes only ever use the
          latest published version, never the live draft directly.
        </p>

        {fetchError && <p className="mb-4 text-sm text-red-600">{fetchError}</p>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div>
            <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
              <p className="mb-2 text-sm font-medium text-slate-700">New plan</p>
              <div className="flex gap-2">
                <input
                  value={newPlanName}
                  onChange={(e) => setNewPlanName(e.target.value)}
                  placeholder="Plan name"
                  className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <button onClick={handleCreatePlan} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                  Create
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`block w-full border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50 ${
                    selectedPlanId === plan.id ? "bg-brand-50" : ""
                  }`}
                >
                  <p className="font-medium text-slate-900">{plan.name}</p>
                  <p className="text-xs text-slate-400">{plan.active ? "Active" : "Inactive"}</p>
                </button>
              ))}
              {plans.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">No plans yet.</p>}
            </div>
          </div>

          <div className="lg:col-span-2">
            {!selectedPlan ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-400">
                Select a plan to manage its rules.
              </p>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">{selectedPlan.name}</h2>
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {publishing ? "Publishing…" : "Publish draft rules"}
                  </button>
                </div>

                {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}

                <div className="mb-4 space-y-3">
                  {rules.map((rule) => (
                    <div key={rule.id} className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-sm font-medium text-slate-800">{rule.ruleType}</span>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1 text-xs text-slate-500">
                            Priority
                            <input
                              type="number"
                              defaultValue={rule.priority}
                              onBlur={(e) => handleUpdateRule(rule.id, rule.params, Number(e.target.value))}
                              className="w-16 rounded border border-slate-300 px-1 py-0.5"
                            />
                          </label>
                          <button onClick={() => handleDeleteRule(rule.id)} className="text-xs text-red-600 hover:underline">
                            Delete
                          </button>
                        </div>
                      </div>
                      <RuleParamsForm
                        ruleType={rule.ruleType}
                        params={rule.params}
                        onChange={(params) => handleUpdateRule(rule.id, params, rule.priority)}
                      />
                    </div>
                  ))}
                  {rules.length === 0 && (
                    <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-400">
                      No draft rules yet — add one below.
                    </p>
                  )}
                </div>

                <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
                  <p className="mb-2 text-sm font-medium text-slate-700">Add a rule</p>
                  <div className="mb-2 flex items-center gap-2">
                    <select
                      value={newRuleType}
                      onChange={(e) => {
                        const ruleType = e.target.value as (typeof RULE_TYPES)[number];
                        setNewRuleType(ruleType);
                        setNewRuleParams(defaultParamsFor(ruleType));
                      }}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      {RULE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      Priority
                      <input
                        type="number"
                        value={newRulePriority}
                        onChange={(e) => setNewRulePriority(e.target.value)}
                        className="w-16 rounded border border-slate-300 px-1 py-0.5"
                      />
                    </label>
                    <button onClick={handleAddRule} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                      Add rule
                    </button>
                  </div>
                  <RuleParamsForm ruleType={newRuleType} params={newRuleParams} onChange={setNewRuleParams} />
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="mb-2 text-sm font-medium text-slate-700">Published versions</p>
                  {versions.length === 0 && <p className="text-sm text-slate-400">No versions published yet.</p>}
                  <ul className="space-y-1 text-sm text-slate-600">
                    {versions.map((v) => (
                      <li key={v.id}>
                        v{v.versionNo} — published {new Date(v.publishedAt).toLocaleString()}
                        {v.publishedBy ? ` by ${v.publishedBy}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
