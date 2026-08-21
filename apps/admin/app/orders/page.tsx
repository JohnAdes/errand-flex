"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";
import { useAuth } from "../../lib/auth-context";
import { api } from "../../lib/api";

const STATUS_COLORS: Record<string, string> = {
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  DELIVERY_FAILED: "bg-rose-50 text-rose-700 ring-rose-600/20",
  DISPUTED: "bg-amber-50 text-amber-700 ring-amber-600/20",
};

function statusBadge(status: string) {
  return STATUS_COLORS[status] ?? "bg-brand-50 text-brand-700 ring-brand-600/20";
}

export default function OrdersPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [ordersData, kpiData] = await Promise.all([
        api.getOrders(session.token, statusFilter || undefined),
        api.getKpis(session.token),
      ]);
      setOrders(ordersData);
      setKpis(kpiData);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load orders");
    }
  }, [session, statusFilter]);

  useEffect(() => {
    if (!loading && !session) router.push("/login");
  }, [loading, session, router]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000); // live-ish polling; swap for websockets/SSE in production
    return () => clearInterval(interval);
  }, [load]);

  if (loading || !session) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Live Orders</h1>
          <p className="mt-1 text-sm text-slate-500">Real-time view of every order moving through the marketplace.</p>
        </div>

        {kpis && (
          <div className="mb-8 grid grid-cols-3 gap-4">
            <KpiCard label="Total orders" value={kpis.totalOrders} icon="package" />
            <KpiCard label="Active drivers online" value={kpis.activeDrivers} icon="driver" accent="brand" />
            <KpiCard label="Revenue (delivered)" value={`$${(kpis.totalRevenueCents / 100).toFixed(2)}`} icon="revenue" accent="accent" />
          </div>
        )}

        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm font-medium text-slate-600">Filter by status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">All</option>
            <option value="SEARCHING_FOR_DRIVER">Searching for driver</option>
            <option value="DRIVER_ASSIGNED">Driver assigned</option>
            <option value="PICKED_UP">Picked up</option>
            <option value="IN_TRANSIT">In transit</option>
            <option value="DELIVERED">Delivered</option>
            <option value="DELIVERY_FAILED">Delivery failed</option>
            <option value="CANCELED">Canceled</option>
          </select>
        </div>

        {fetchError && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fetchError}</p>}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Service level</th>
                <th className="px-4 py-3 font-medium">Packages</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{order.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${statusBadge(order.status)}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{order.serviceLevel}</td>
                  <td className="px-4 py-3 text-slate-700">{order.packages?.length ?? 0}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">${((order.totalCents ?? 0) / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(order.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                    No orders yet — create one via the customer flow or POST /v1/orders.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

const KPI_ICONS: Record<string, React.ReactNode> = {
  package: (
    <path d="M3 7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" strokeWidth="1.6" strokeLinejoin="round" />
  ),
  driver: <circle cx="12" cy="12" r="8" strokeWidth="1.6" />,
  revenue: <path d="M12 4v16M8 8h5.5a2.5 2.5 0 1 1 0 5H8m0 0h6.5a2.5 2.5 0 1 1 0 5H8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
};

function KpiCard({
  label,
  value,
  icon,
  accent = "slate",
}: {
  label: string;
  value: string | number;
  icon: keyof typeof KPI_ICONS;
  accent?: "slate" | "brand" | "accent";
}) {
  const accentClasses =
    accent === "brand"
      ? "bg-brand-50 text-brand-600"
      : accent === "accent"
        ? "bg-accent-50 text-accent-600"
        : "bg-slate-100 text-slate-500";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accentClasses}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
            {KPI_ICONS[icon]}
          </svg>
        </div>
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-xl font-semibold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
