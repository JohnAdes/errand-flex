// Shared back-office role groups for requireRole(...) — previously copy-pasted
// as separate literal arrays in dispatch.routes.ts, claims.routes.ts,
// payments.routes.ts, and admin.routes.ts, which had no compiler-enforced
// way to stay in sync: adding or removing a role meant editing 4+ files by
// hand with nothing to catch a missed one.
export const OPS_ROLES = ["OPS_MANAGER", "SUPER_ADMIN"] as const;
export const DISPATCH_ROLES = ["DISPATCHER", "OPS_MANAGER", "SUPER_ADMIN"] as const;
export const FINANCE_ROLES = ["FINANCE", "OPS_MANAGER", "SUPER_ADMIN"] as const;
