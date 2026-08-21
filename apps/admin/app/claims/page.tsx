"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";
import { useAuth } from "../../lib/auth-context";
import { api } from "../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-700 ring-amber-600/20",
  RESOLVED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  REJECTED: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export default function ClaimsPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [claims, setClaims] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<any | null>(null);
  const [resolution, setResolution] = useState("");
  const [refundCents, setRefundCents] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api.getClaims(session.token, statusFilter || undefined);
      setClaims(data);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load claims");
    }
  }, [session, statusFilter]);

  useEffect(() => {
    if (!loading && !session) router.push("/login");
  }, [loading, session, router]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleResolve(outcome: "RESOLVED" | "REJECTED") {
    if (!session || !selected) return;
    if (!resolution.trim()) {
      setResolveError("Explain the resolution");
      return;
    }
    setResolving(true);
    setResolveError(null);
    try {
      const cents = refundCents.trim() ? Math.round(parseFloat(refundCents) * 100) : undefined;
      await api.resolveClaim(selected.id, { outcome, resolution: resolution.trim(), refundCents: cents }, session.token);
      setSelected(null);
      setResolution("");
      setRefundCents("");
      await load();
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Failed to resolve claim");
    } finally {
      setResolving(false);
    }
  }

  if (loading || !session) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Claims & Disputes</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Customer- and driver-filed exceptions — resolving one can issue a real refund.</p>

        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm font-medium text-slate-600">Filter by status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>

        {fetchError && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fetchError}</p>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            {claims.map((claim) => (
              <div
                key={claim.id}
                onClick={() => {
                  setSelected(claim);
                  setResolveError(null);
                }}
                className={`cursor-pointer rounded-xl border bg-white p-4 shadow-sm shadow-slate-200/50 transition-all hover:shadow-md hover:shadow-slate-200/60 ${
                  selected?.id === claim.id ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_COLORS[claim.status] ?? ""}`}>
                      {claim.status}
                    </span>
                    <p className="mt-2 text-sm font-medium text-slate-900">{claim.type}</p>
                    <p className="text-sm text-slate-500">{claim.description}</p>
                  </div>
                  <p className="font-mono text-xs text-slate-400">{claim.orderId.slice(0, 8)}</p>
                </div>
              </div>
            ))}
            {claims.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">No claims found.</p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
            {!selected ? (
              <p className="text-sm text-slate-400">Select a claim to review and resolve it.</p>
            ) : (
              <>
                <h2 className="mb-1 text-lg font-semibold text-slate-900">{selected.type}</h2>
                <p className="mb-1 text-xs text-slate-400">Order {selected.orderId}</p>
                <p className="mb-4 text-sm text-slate-700">{selected.description}</p>

                {selected.status !== "OPEN" ? (
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    <p className="font-medium">{selected.status}</p>
                    <p>{selected.resolution}</p>
                  </div>
                ) : (
                  <>
                    <label className="mb-1 block text-xs text-slate-500">Resolution notes</label>
                    <textarea
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                      rows={3}
                    />
                    <label className="mb-1 block text-xs text-slate-500">Refund amount, $ (optional — only when upholding)</label>
                    <input
                      value={refundCents}
                      onChange={(e) => setRefundCents(e.target.value)}
                      className="mb-3 w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                      placeholder="0.00"
                    />
                    {resolveError && <p className="mb-3 text-sm text-rose-600">{resolveError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleResolve("RESOLVED")}
                        disabled={resolving}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Uphold (resolve{refundCents.trim() ? " + refund" : ""})
                      </button>
                      <button
                        onClick={() => handleResolve("REJECTED")}
                        disabled={resolving}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
