"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";
import { useAuth } from "../../lib/auth-context";
import { api } from "../../lib/api";

const BATCH_STATUS_COLORS: Record<string, string> = {
  SUGGESTED: "bg-amber-50 text-amber-700 ring-amber-600/20",
  APPROVED: "bg-brand-50 text-brand-700 ring-brand-600/20",
  OFFERED: "bg-violet-50 text-violet-700 ring-violet-600/20",
  ASSIGNED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  REJECTED: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export default function DispatchPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [batches, setBatches] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [payoutInputs, setPayoutInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api.getRouteBatches(session.token, statusFilter || undefined);
      setBatches(data);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load route batches");
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

  async function handleSuggest() {
    if (!session) return;
    setSuggesting(true);
    setFetchError(null);
    try {
      await api.suggestRouteBatches(session.token);
      await load();
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Suggestion run failed");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleApprove(id: string) {
    if (!session) return;
    setBusyId(id);
    try {
      await api.approveRouteBatch(id, session.token);
      await load();
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    if (!session) return;
    setBusyId(id);
    try {
      await api.rejectRouteBatch(id, session.token);
      await load();
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Rejection failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleOffer(id: string) {
    if (!session) return;
    const payoutDollars = parseFloat(payoutInputs[id] ?? "");
    if (!payoutDollars || payoutDollars <= 0) {
      setFetchError("Enter a payout amount before offering this batch");
      return;
    }
    setBusyId(id);
    setFetchError(null);
    try {
      await api.offerRouteBatch(id, Math.round(payoutDollars * 100), session.token);
      await load();
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Offer failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading || !session) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Route Batches</h1>
            <p className="mt-1 text-sm text-slate-500">Grouped-order suggestions from the batching algorithm — review, approve, and offer to a driver.</p>
          </div>
          <button
            onClick={handleSuggest}
            disabled={suggesting}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-accent-500/25 transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {suggesting ? "Running…" : "Run suggestion now"}
          </button>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm font-medium text-slate-600">Filter by status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">All</option>
            <option value="SUGGESTED">Suggested</option>
            <option value="APPROVED">Approved</option>
            <option value="OFFERED">Offered</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>

        {fetchError && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fetchError}</p>}

        <div className="space-y-3">
          {batches.map((batch) => {
            const reason = batch.groupingReason ?? {};
            const orders = (batch.assignments ?? []).map((a: any) => a.order).filter(Boolean);
            return (
              <div key={batch.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${BATCH_STATUS_COLORS[batch.status] ?? ""}`}>
                      {batch.status}
                    </span>
                    <p className="mt-2 text-sm text-slate-600">
                      {orders.length} order(s) · detour ratio {reason.detourRatio?.toFixed(2) ?? "—"} · group discount{" "}
                      <span className="font-medium text-emerald-600">{reason.groupDiscountRate ?? 0}%</span>
                    </p>
                  </div>
                  <p className="font-mono text-xs text-slate-400">{batch.id.slice(0, 8)}</p>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
                  {orders.map((o: any) => (
                    <div key={o.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                      #{o.id.slice(0, 8)} · {o.serviceLevel} · ${((o.totalCents ?? 0) / 100).toFixed(2)}
                    </div>
                  ))}
                </div>

                {batch.status === "SUGGESTED" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(batch.id)}
                      disabled={busyId === batch.id}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(batch.id)}
                      disabled={busyId === batch.id}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}

                {batch.status === "APPROVED" && (
                  <div className="flex items-end gap-2">
                    <div>
                      <label className="block text-xs text-slate-500">Payout, $</label>
                      <input
                        value={payoutInputs[batch.id] ?? ""}
                        onChange={(e) => setPayoutInputs((prev) => ({ ...prev, [batch.id]: e.target.value }))}
                        className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                        placeholder="25.00"
                      />
                    </div>
                    <button
                      onClick={() => handleOffer(batch.id)}
                      disabled={busyId === batch.id}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
                    >
                      Offer to top driver
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {batches.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
              No route batches — run the suggestion algorithm, or wait for its scheduled run (every 5 minutes with Redis configured).
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
