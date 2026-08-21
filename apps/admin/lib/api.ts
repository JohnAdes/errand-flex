const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? "Request failed");
  }

  return res.json() as Promise<T>;
}

export interface Session {
  token: string;
  userId: string;
  role: string;
}

export const api = {
  login: (email: string, password: string) =>
    request<Session>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  getPendingDrivers: (token: string) => request<any[]>("/v1/admin/drivers/pending", {}, token),

  approveDriver: (id: string, token: string) =>
    request<any>(`/v1/admin/drivers/${id}/approve`, { method: "POST", body: JSON.stringify({}) }, token),

  suspendDriver: (id: string, reason: string, token: string) =>
    request<any>(`/v1/admin/drivers/${id}/suspend`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }, token),

  getOrders: (token: string, status?: string) =>
    request<any[]>(`/v1/admin/orders${status ? `?status=${status}` : ""}`, {}, token),

  getKpis: (token: string) => request<any>("/v1/admin/reports/kpis", {}, token),

  getAuditLogs: (token: string, entityId?: string) =>
    request<any[]>(`/v1/admin/audit-logs${entityId ? `?entityId=${entityId}` : ""}`, {}, token),

  // ---------- Business accounts ----------
  getBusinessAccounts: (token: string) => request<any[]>("/v1/admin/business-accounts", {}, token),

  getBusinessAccount: (id: string, token: string) => request<any>(`/v1/admin/business-accounts/${id}`, {}, token),

  createBusinessAccount: (
    body: { name: string; contactEmail?: string; discountTiers?: Array<{ minOrdersPerMonth: number; discountPercent: number }> },
    token: string
  ) => request<any>("/v1/admin/business-accounts", { method: "POST", body: JSON.stringify(body) }, token),

  updateBusinessAccountTiers: (
    id: string,
    discountTiers: Array<{ minOrdersPerMonth: number; discountPercent: number }>,
    token: string
  ) =>
    request<any>(
      `/v1/admin/business-accounts/${id}/discount-tiers`,
      { method: "PATCH", body: JSON.stringify({ discountTiers }) },
      token
    ),

  addBusinessAccountMember: (id: string, customerProfileId: string, token: string) =>
    request<any>(`/v1/admin/business-accounts/${id}/members`, { method: "POST", body: JSON.stringify({ customerProfileId }) }, token),

  removeBusinessAccountMember: (customerProfileId: string, token: string) =>
    request<any>(`/v1/admin/business-accounts/members/${customerProfileId}`, { method: "DELETE" }, token),

  // ---------- Claims / disputes ----------
  getClaims: (token: string, status?: string) =>
    request<any[]>(`/v1/admin/claims${status ? `?status=${status}` : ""}`, {}, token),

  getClaim: (id: string, token: string) => request<any>(`/v1/admin/claims/${id}`, {}, token),

  resolveClaim: (id: string, body: { outcome: "RESOLVED" | "REJECTED"; resolution: string; refundCents?: number }, token: string) =>
    request<any>(`/v1/admin/claims/${id}/resolve`, { method: "POST", body: JSON.stringify(body) }, token),

  // ---------- Payments & payouts ----------
  getPayments: (token: string, status?: string) =>
    request<any[]>(`/v1/admin/payments${status ? `?status=${status}` : ""}`, {}, token),

  getPayouts: (token: string, driverId?: string) =>
    request<any[]>(`/v1/admin/payouts${driverId ? `?driverId=${driverId}` : ""}`, {}, token),

  runPayout: (body: { driverId: string; periodStart: string; periodEnd: string }, token: string) =>
    request<any>("/v1/admin/payouts/run", { method: "POST", body: JSON.stringify(body) }, token),

  // ---------- Dispatch / route batches ----------
  getRouteBatches: (token: string, status?: string) =>
    request<any[]>(`/v1/admin/dispatch/batches${status ? `?status=${status}` : ""}`, {}, token),

  suggestRouteBatches: (token: string) =>
    request<any[]>("/v1/internal/dispatch/batches/suggest", { method: "POST", body: JSON.stringify({}) }, token),

  approveRouteBatch: (id: string, token: string) =>
    request<any>(`/v1/admin/dispatch/batches/${id}/approve`, { method: "POST", body: JSON.stringify({}) }, token),

  rejectRouteBatch: (id: string, token: string) =>
    request<any>(`/v1/admin/dispatch/batches/${id}/reject`, { method: "POST", body: JSON.stringify({}) }, token),

  offerRouteBatch: (id: string, payoutCents: number, token: string) =>
    request<any>(`/v1/internal/dispatch/batches/${id}/offer`, { method: "POST", body: JSON.stringify({ payoutCents }) }, token),

  // ---------- Pricing ----------
  getPricingPlans: (token: string) => request<any[]>("/v1/admin/pricing/plans", {}, token),

  createPricingPlan: (body: { name: string; scope?: Record<string, unknown> }, token: string) =>
    request<any>("/v1/admin/pricing/plans", { method: "POST", body: JSON.stringify(body) }, token),

  getPricingRules: (planId: string, token: string) => request<any[]>(`/v1/admin/pricing/plans/${planId}/rules`, {}, token),

  createPricingRule: (planId: string, body: { ruleType: string; params: Record<string, unknown>; priority: number }, token: string) =>
    request<any>(`/v1/admin/pricing/plans/${planId}/rules`, { method: "POST", body: JSON.stringify(body) }, token),

  updatePricingRule: (ruleId: string, body: { params?: Record<string, unknown>; priority?: number }, token: string) =>
    request<any>(`/v1/admin/pricing/rules/${ruleId}`, { method: "PATCH", body: JSON.stringify(body) }, token),

  deletePricingRule: (ruleId: string, token: string) =>
    request<any>(`/v1/admin/pricing/rules/${ruleId}`, { method: "DELETE" }, token),

  getPricingVersions: (planId: string, token: string) => request<any[]>(`/v1/admin/pricing/plans/${planId}/versions`, {}, token),

  publishPricingPlan: (planId: string, token: string) =>
    request<any>(`/v1/admin/pricing/plans/${planId}/publish`, { method: "POST", body: JSON.stringify({}) }, token),
};
