"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function LoginPage() {
  const [email, setEmail] = useState("owen@example.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.login(email, password);
      if (!["DISPATCHER", "OPS_MANAGER", "FINANCE", "SUPER_ADMIN"].includes(session.role)) {
        setError("This account does not have admin portal access.");
        return;
      }
      login(session);
      router.push("/orders");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{ backgroundImage: "radial-gradient(circle at 20% 20%, white 1px, transparent 1px)", backgroundSize: "28px 28px" }}
        />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M3 7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M14 10h3.6a1 1 0 0 1 .8.4l2.2 2.9a1 1 0 0 1 .2.6V16a1 1 0 0 1-1 1H14" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
              <circle cx="7.5" cy="17.5" r="1.6" fill="white" />
              <circle cx="16.5" cy="17.5" r="1.6" fill="white" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">Courier Ops</span>
        </div>

        <div className="relative">
          <p className="max-w-md text-3xl font-semibold leading-tight text-white">
            Every order, driver, and dollar — one operational view.
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-brand-100">
            Dispatch grouped routes, review claims, tune pricing, and keep the whole marketplace running from a single portal.
          </p>
        </div>

        <p className="relative text-xs text-brand-200">Internal tool — dispatcher, ops, finance, and admin access only.</p>
      </div>

      <div className="flex items-center justify-center bg-slate-50 px-6 py-12">
        <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm shadow-slate-200/60">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700">
              <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
                <path d="M3 7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
                <circle cx="7.5" cy="17.5" r="1.6" fill="white" />
                <circle cx="16.5" cy="17.5" r="1.6" fill="white" />
              </svg>
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">Courier Ops</span>
          </div>

          <h1 className="mb-1 text-xl font-semibold text-slate-900">Welcome back</h1>
          <p className="mb-6 text-sm text-slate-500">Sign in with a dispatcher, ops, finance, or admin account.</p>

          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-shadow focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            required
          />

          <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-shadow focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            required
          />

          {error && (
            <p className="mb-4 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-5 text-xs text-slate-400">
            Seeded admin account: owen@example.com / password123 (see apps/api/src/db/seed.ts)
          </p>
        </form>
      </div>
    </div>
  );
}
