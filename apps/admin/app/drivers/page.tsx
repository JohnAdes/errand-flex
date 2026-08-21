"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";
import { useAuth } from "../../lib/auth-context";
import { api } from "../../lib/api";

export default function DriversPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [drivers, setDrivers] = useState<any[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api.getPendingDrivers(session.token);
      setDrivers(data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load drivers");
    }
  }, [session]);

  useEffect(() => {
    if (!loading && !session) router.push("/login");
  }, [loading, session, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(driverId: string) {
    if (!session) return;
    setBusyId(driverId);
    setActionError(null);
    try {
      await api.approveDriver(driverId, session.token);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSuspend(driverId: string) {
    if (!session) return;
    const reason = window.prompt("Reason for suspension:");
    if (!reason) return;
    setBusyId(driverId);
    setActionError(null);
    try {
      await api.suspendDriver(driverId, reason, session.token);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Suspension failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading || !session) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Driver Approval Queue</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">
          Drivers with status PENDING — review documents/vehicles before approving.
        </p>

        {actionError && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</p>}

        <div className="space-y-3">
          {drivers.map((driver) => {
            const email = driver.user?.email ?? driver.userId;
            return (
              <div
                key={driver.id}
                className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50 transition-shadow hover:shadow-md hover:shadow-slate-200/60"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                    {email.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{email}</p>
                    <p className="text-sm text-slate-500">
                      {driver.vehicles?.length ?? 0} vehicle(s) · {driver.documents?.length ?? 0} document(s) on file
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(driver.id)}
                    disabled={busyId === driver.id}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleSuspend(driver.id)}
                    disabled={busyId === driver.id}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                  >
                    Reject / suspend
                  </button>
                </div>
              </div>
            );
          })}
          {drivers.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
              No drivers pending review.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
