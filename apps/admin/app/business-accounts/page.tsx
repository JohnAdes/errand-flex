"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "../../components/Nav";
import { useAuth } from "../../lib/auth-context";
import { api } from "../../lib/api";

export default function BusinessAccountsPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [selected, setSelected] = useState<any | null>(null);
  const [memberProfileId, setMemberProfileId] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [tierMin, setTierMin] = useState("20");
  const [tierPercent, setTierPercent] = useState("10");
  const [tierError, setTierError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api.getBusinessAccounts(session.token);
      setAccounts(data);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load business accounts");
    }
  }, [session]);

  useEffect(() => {
    if (!loading && !session) router.push("/login");
  }, [loading, session, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function refreshSelected() {
    if (!session || !selected) return;
    const fresh = await api.getBusinessAccount(selected.id, session.token);
    setSelected(fresh);
    await load();
  }

  async function handleCreate() {
    if (!session || !name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.createBusinessAccount({ name: name.trim(), contactEmail: contactEmail.trim() || undefined }, session.token);
      setName("");
      setContactEmail("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create business account");
    } finally {
      setCreating(false);
    }
  }

  async function handleAddMember() {
    if (!session || !selected || !memberProfileId.trim()) return;
    setMemberError(null);
    try {
      await api.addBusinessAccountMember(selected.id, memberProfileId.trim(), session.token);
      setMemberProfileId("");
      await refreshSelected();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Failed to add member");
    }
  }

  async function handleRemoveMember(customerProfileId: string) {
    if (!session) return;
    try {
      await api.removeBusinessAccountMember(customerProfileId, session.token);
      await refreshSelected();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  async function handleAddTier() {
    if (!session || !selected) return;
    const minOrdersPerMonth = parseInt(tierMin, 10);
    const discountPercent = parseFloat(tierPercent);
    if (!minOrdersPerMonth || Number.isNaN(discountPercent)) {
      setTierError("Enter a valid threshold and percent");
      return;
    }
    setTierError(null);
    try {
      const existingTiers = (selected.discountTiers ?? []).filter((t: any) => t.minOrdersPerMonth !== minOrdersPerMonth);
      const nextTiers = [...existingTiers, { minOrdersPerMonth, discountPercent }].sort(
        (a, b) => a.minOrdersPerMonth - b.minOrdersPerMonth
      );
      await api.updateBusinessAccountTiers(selected.id, nextTiers, session.token);
      await refreshSelected();
    } catch (err) {
      setTierError(err instanceof Error ? err.message : "Failed to update tiers");
    }
  }

  if (loading || !session) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-2 text-2xl font-semibold text-slate-900">Business Accounts</h1>
        <p className="mb-6 text-sm text-slate-500">
          Groups customer profiles under one business so volume-based pricing can react to their combined monthly order count.
        </p>

        {fetchError && <p className="mb-4 text-sm text-red-600">{fetchError}</p>}

        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
          <p className="mb-3 text-sm font-medium text-slate-700">New business account</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-500">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                placeholder="Acme Retail"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">Contact email (optional)</label>
              <input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                placeholder="ops@acme.example"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Create
            </button>
          </div>
          {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">This month</th>
                  <th className="px-4 py-3 font-medium">Tiers</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr
                    key={account.id}
                    onClick={() => setSelected(account)}
                    className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                      selected?.id === account.id ? "bg-brand-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{account.name}</p>
                      <p className="text-xs text-slate-400">{account.contactEmail ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">{account.monthlyOrderCount} orders</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {(account.discountTiers ?? []).length === 0
                        ? "None"
                        : account.discountTiers.map((t: any) => `${t.minOrdersPerMonth}+ → ${t.discountPercent}%`).join(", ")}
                    </td>
                  </tr>
                ))}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                      No business accounts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            {!selected ? (
              <p className="text-sm text-slate-400">Select a business account to manage its members and discount tiers.</p>
            ) : (
              <>
                <h2 className="mb-1 text-lg font-semibold text-slate-900">{selected.name}</h2>
                <p className="mb-4 text-sm text-slate-500">{selected.monthlyOrderCount} orders this calendar month</p>

                <p className="mb-2 text-sm font-medium text-slate-700">Discount tiers</p>
                <ul className="mb-3 space-y-1 text-sm text-slate-600">
                  {(selected.discountTiers ?? []).map((t: any) => (
                    <li key={t.minOrdersPerMonth}>
                      {t.minOrdersPerMonth}+ orders/mo → {t.discountPercent}% off
                    </li>
                  ))}
                  {(selected.discountTiers ?? []).length === 0 && <li className="text-slate-400">No custom tiers — falls back to the platform default.</li>}
                </ul>
                <div className="mb-4 flex items-end gap-2">
                  <div>
                    <label className="block text-xs text-slate-500">Min orders/mo</label>
                    <input
                      value={tierMin}
                      onChange={(e) => setTierMin(e.target.value)}
                      className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500">Discount %</label>
                    <input
                      value={tierPercent}
                      onChange={(e) => setTierPercent(e.target.value)}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <button onClick={handleAddTier} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
                    Add / update tier
                  </button>
                </div>
                {tierError && <p className="mb-3 text-sm text-red-600">{tierError}</p>}

                <p className="mb-2 text-sm font-medium text-slate-700">Members</p>
                <ul className="mb-3 space-y-1 text-sm text-slate-600">
                  {(selected.members ?? []).map((m: any) => (
                    <li key={m.id} className="flex items-center justify-between">
                      <span>{m.displayName}</span>
                      <button onClick={() => handleRemoveMember(m.id)} className="text-xs text-red-600 hover:underline">
                        Remove
                      </button>
                    </li>
                  ))}
                  {(selected.members ?? []).length === 0 && <li className="text-slate-400">No members yet.</li>}
                </ul>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-slate-500">Customer profile ID</label>
                    <input
                      value={memberProfileId}
                      onChange={(e) => setMemberProfileId(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                      placeholder="uuid"
                    />
                  </div>
                  <button onClick={handleAddMember} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
                    Add member
                  </button>
                </div>
                {memberError && <p className="mt-2 text-sm text-red-600">{memberError}</p>}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
