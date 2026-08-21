"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";
import { useAuth } from "../../lib/auth-context";
import { api } from "../../lib/api";

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  AUTHORIZED: "bg-brand-50 text-brand-700 ring-brand-600/20",
  CAPTURED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  PARTIALLY_REFUNDED: "bg-amber-50 text-amber-700 ring-amber-600/20",
  REFUNDED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  FAILED: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

export default function PaymentsPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [payments, setPayments] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [driverId, setDriverId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [paymentsData, payoutsData] = await Promise.all([api.getPayments(session.token), api.getPayouts(session.token)]);
      setPayments(paymentsData);
      setPayouts(payoutsData);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load payments");
    }
  }, [session]);

  useEffect(() => {
    if (!loading && !session) router.push("/login");
  }, [loading, session, router]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleRunPayout() {
    if (!session || !driverId.trim() || !periodStart || !periodEnd) {
      setRunError("Driver id and both dates are required");
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      await api.runPayout(
        { driverId: driverId.trim(), periodStart: new Date(periodStart).toISOString(), periodEnd: new Date(periodEnd).toISOString() },
        session.token
      );
      setDriverId("");
      await load();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Payout run failed");
    } finally {
      setRunning(false);
    }
  }

  if (loading || !session) return null;

  const totalCaptured = payments.filter((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED").reduce((s, p) => s + p.amountCents, 0);
  const totalRefunded = payments.reduce((s, p) => s + (p.refunds ?? []).reduce((rs: number, r: any) => rs + r.amountCents, 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Payments & Payouts</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Capture/refund ledger and driver payout runs.</p>

        <div className="mb-8 grid grid-cols-3 gap-4">
          <KpiCard label="Captured (gross)" value={`$${(totalCaptured / 100).toFixed(2)}`} accent="brand" />
          <KpiCard label="Refunded/discounted" value={`$${(totalRefunded / 100).toFixed(2)}`} accent="accent" />
          <KpiCard label="Payouts issued" value={payouts.length} />
        </div>

        {fetchError && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fetchError}</p>}

        <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
          <p className="mb-3 text-sm font-medium text-slate-700">Run a payout for a driver</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-500">Driver ID</label>
              <input value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-72 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" placeholder="uuid" />
            </div>
            <div>
              <label className="block text-xs text-slate-500">Period start</label>
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </div>
            <div>
              <label className="block text-xs text-slate-500">Period end</label>
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </div>
            <button onClick={handleRunPayout} disabled={running} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50">
              Run payout
            </button>
          </div>
          {runError && <p className="mt-2 text-sm text-rose-600">{runError}</p>}
          <p className="mt-2 text-xs text-slate-400">
            Batches every PENDING earning for that driver into one PAID payout. The scheduled weekly job (see README) does this automatically for every driver — use this for an ad-hoc run.
          </p>
        </div>

        <h2 className="mb-3 text-lg font-semibold text-slate-900">Payments</h2>
        <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Refunded</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const refunded = (p.refunds ?? []).reduce((s: number, r: any) => s + r.amountCents, 0);
                return (
                  <tr key={p.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.orderId.slice(0, 8)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${PAYMENT_STATUS_COLORS[p.status] ?? ""}`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">${(p.amountCents / 100).toFixed(2)}</td>
                    <td className="px-4 py-3 text-rose-600">{refunded > 0 ? `-$${(refunded / 100).toFixed(2)}` : "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(p.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">No payments yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h2 className="mb-3 text-lg font-semibold text-slate-900">Payouts</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Driver</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.driverId.slice(0, 8)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">${(p.amountCents / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">No payouts yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function KpiCard({ label, value, accent = "slate" }: { label: string; value: string | number; accent?: "slate" | "brand" | "accent" }) {
  const barColor = accent === "brand" ? "bg-brand-500" : accent === "accent" ? "bg-accent-500" : "bg-slate-300";
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
      <div className={`h-1 w-full ${barColor}`} />
      <div className="p-4">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      </div>
    </div>
  );
}
