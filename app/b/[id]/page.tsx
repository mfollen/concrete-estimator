"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { computeTotals } from "../../../utils/estimate";

// ------- Lightweight shapes (for editor hints only)
type Project = {
  id: string;
  name: string;
  orgId: string;
  clientName?: string | null;
  location?: string | null;
  createdat?: string | null;
};

type Estimate = {
  id: string;
  projectId: string;
  title: string;
  overheadPct?: number | null;
  mobilizationCount?: number | null;
  overtimeHoursPerDay?: number | null;
  markupPct?: number | null;
  contingencyPct?: number | null;
  createdat?: string | null;
};

type EstimateItem = {
  id: string;
  estimateId: string;
  kind: string;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  markupPct?: number | null;
  contingencyPct?: number | null;
  durationHours?: number | null;
  isMaterial?: boolean | null;
  isLabor?: boolean | null;
  // NOTE: no rank / isEquipment persistence for now (schema doesn’t have them)
};

type OrgSettings = {
  orgId: string;
  useMarkupTiers: boolean;
  defaultContingency: number;
  contingencyOrder: "AFTER_MARKUP" | "BEFORE_MARKUP";
  mobilizationPrice: number;
  mobilizationAutoPerCrewDay?: boolean | null;
  crewHoursPerDay?: number | null;
  logoUrl?: string | null;
  validityDays?: number | null;
};

type TaxScope = {
  orgId: string;
  rate: number;
  taxMaterials: boolean;
  taxLabor: boolean;
  taxEquipment: boolean;
  taxMarkup: boolean;
  taxContingency: boolean;
};

type MarkupTier = {
  orgId: string;
  minAmount: number;
  maxAmount: number | null;
  percent: number;
  rank: number;
};

export default function EstimatePage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [tax, setTax] = useState<TaxScope | null>(null);
  const [tiers, setTiers] = useState<MarkupTier[]>([]);

  // Small UI states for CRUD
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // 1) Project
        const { data: p, error: pErr } = await supabase
          .from("Project")
          .select("*")
          .eq("id", projectId)
          .maybeSingle();
        if (pErr) throw pErr;
        if (!p) throw new Error("Project not found");
        if (!isMounted) return;
        setProject(p as Project);

        // 2) Latest Estimate
        const { data: est, error: estErr } = await supabase
          .from("Estimate")
          .select("*")
          .eq("projectId", projectId)
          .order("createdat", { ascending: false })
          .maybeSingle();
        if (estErr) throw estErr;
        if (!isMounted) return;
        setEstimate(est as Estimate | null);

        // 3) Estimate items (no rank column; sort stably by id for now)
        if (est?.id) {
          const { data: its, error: itsErr } = await supabase
            .from("EstimateItem")
            .select("*")
            .eq("estimateId", est.id);
          if (itsErr) throw itsErr;
          if (!isMounted) return;

          const sorted = ((its as any[]) ?? [])
            .slice()
            .sort((a, b) =>
              String(a?.id ?? "").localeCompare(String(b?.id ?? ""))
            );

          setItems(sorted as EstimateItem[]);
        } else {
          if (!isMounted) return;
          setItems([]);
        }

        // 4) Settings / Tax / Tiers (fetch raw; sort tiers client-side)
        if (p?.orgId) {
          const [
            { data: s, error: sErr },
            { data: t, error: tErr },
            { data: tr, error: trErr },
          ] = await Promise.all([
            supabase
              .from("OrgSettings")
              .select("*")
              .eq("orgId", p.orgId)
              .maybeSingle(),
            supabase
              .from("TaxScope")
              .select("*")
              .eq("orgId", p.orgId)
              .maybeSingle(),
            supabase.from("MarkupTier").select("*").eq("orgId", p.orgId),
          ]);
          if (sErr) throw sErr;
          if (tErr) throw tErr;
          if (trErr) throw trErr;
          if (!isMounted) return;

          setSettings(s as OrgSettings | null);
          setTax(t as TaxScope | null);

          const sortedTiers = ((tr as any[]) ?? [])
            .slice()
            .sort((a, b) => (a?.rank ?? 0) - (b?.rank ?? 0));
          setTiers(sortedTiers as MarkupTier[]);
        } else {
          if (!isMounted) return;
          setSettings(null);
          setTax(null);
          setTiers([]);
        }
      } catch (err: any) {
        console.error("Estimate page load error:", err);
        if (isMounted) setError(err?.message ?? String(err));
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    if (projectId) load();
    else {
      setLoading(false);
      setError("Missing project id");
    }

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  // ---------- CRUD handlers for EstimateItem ----------

  function updateLocalItem<K extends keyof EstimateItem>(
    id: string,
    key: K,
    value: EstimateItem[K]
  ) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [key]: value } : it))
    );
  }

  async function handleSaveItem(id: string) {
    const current = items.find((it) => it.id === id);
    if (!current) return;
    setSavingId(id);
    try {
      // Only send columns we KNOW exist in the Supabase schema
      const payload: Partial<EstimateItem> = {
        unit: current.unit,
        quantity: current.quantity,
        unitCost: current.unitCost,
        isMaterial: current.isMaterial,
        isLabor: current.isLabor,
      };

      const { data, error: updErr } = await supabase
        .from("EstimateItem")
        .update(payload)
        .eq("id", id)
        .select("*")
        .maybeSingle();

      if (updErr) throw updErr;

      const updated = (data || current) as EstimateItem;
      setItems((prev) =>
        prev
          .map((it) => (it.id === id ? updated : it))
          .slice()
          .sort((a, b) =>
            String(a.id ?? "").localeCompare(String(b.id ?? ""))
          )
      );
    } catch (err: any) {
      console.error("Save item failed:", err);
      alert(err?.message || "Save failed");
    } finally {
      setSavingId(null);
    }
  }

  async function handleAddItem() {
    if (!estimate?.id) {
      alert("No estimate found for this project.");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("EstimateItem")
        .insert({
          estimateId: estimate.id,
          kind: "LINE",
          description: "New line item",
          unit: "EA",
          quantity: 0,
          unitCost: 0,
          isMaterial: true,
          isLabor: true,
          // NOTE: no isEquipment / rank here – your schema doesn’t have them
        })
        .select("*")
        .single();

      if (error) throw error;

      setItems((prev) =>
        [...prev, data as EstimateItem].sort((a, b) =>
          String(a.id ?? "").localeCompare(String(b.id ?? ""))
        )
      );
    } catch (err: any) {
      console.error("Add item failed:", err);
      alert(err?.message || "Add line item failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteItem(id: string) {
    if (!confirm("Delete this line item?")) return;
    setDeletingId(id);
    try {
      const { error } = await supabase
        .from("EstimateItem")
        .delete()
        .eq("id", id);
      if (error) throw error;
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch (err: any) {
      console.error("Delete item failed:", err);
      alert(err?.message || "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  // ---------- Totals using shared computeTotals helper ----------

  const totals = useMemo(
    () =>
      computeTotals({
        // cast to keep TS light for this MVP
        items: items as any,
        estimate: estimate as any,
        settings: settings as any,
        tax: tax as any,
        tiers: tiers.map((t) => ({
          minAmount: t.minAmount,
          maxAmount: t.maxAmount,
          percent: t.percent,
          rank: t.rank,
        })),
      }),
    [items, estimate, settings, tax, tiers]
  );

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Build marker to confirm the new bundle is live */}
      <div className="text-xs text-gray-500 mb-2">
        Build marker: <strong>PROJECT-ESTIMATE-V8-NORANK-NOEQUIP</strong>
      </div>

      <header className="flex items-center justify-between mb-4">
        <nav className="text-sm">
          <Link href="/" className="text-blue-600 hover:underline">
            ← Home
          </Link>
        </nav>
        <div className="text-lg font-semibold">Concrete Estimator</div>
      </header>

      {loading && <div>Loading…</div>}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && !error && project && (
        <div className="space-y-8">
          <section className="rounded-lg border p-4">
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-sm text-gray-600">
              Client: {project.clientName ?? "—"} • Location:{" "}
              {project.location ?? "—"}
            </p>
            <p className="text-xs text-gray-400 mt-1">Project ID: {project.id}</p>
          </section>

          <section className="rounded-lg border p-4">
            <h2 className="text-xl font-semibold mb-2">
              {estimate ? estimate.title : "No estimate yet"}
            </h2>
            {estimate ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-gray-500">Overhead %</div>
                  <div>{estimate.overheadPct ?? 0}%</div>
                </div>
                <div>
                  <div className="text-gray-500">Mobilization Count</div>
                  <div>{estimate.mobilizationCount ?? 0}</div>
                </div>
                <div>
                  <div className="text-gray-500">Overtime Hours / Day</div>
                  <div>{estimate.overtimeHoursPerDay ?? 0}</div>
                </div>
                <div>
                  <div className="text-gray-500">Created</div>
                  <div>
                    {estimate.createdat
                      ? new Date(estimate.createdat).toLocaleString()
                      : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                Create an estimate to get started.
              </p>
            )}
          </section>

          {/* Line Items with CRUD */}
          <section className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">Line Items</h3>
              <button
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-60"
                onClick={handleAddItem}
                disabled={creating || !estimate}
              >
                {creating ? "Adding…" : "Add line item"}
              </button>
            </div>

            {items.length === 0 ? (
              <div className="text-sm text-gray-600">
                No items yet. Click &ldquo;Add line item&rdquo; to get started.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Kind</th>
                      <th className="py-2 pr-3">Description</th>
                      <th className="py-2 pr-3">Unit</th>
                      <th className="py-2 pr-3">Qty</th>
                      <th className="py-2 pr-3">Unit Cost</th>
                      <th className="py-2 pr-3">Cost</th>
                      <th className="py-2 pr-3">Flags</th>
                      <th className="py-2 pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const cost = (it.quantity ?? 0) * (it.unitCost ?? 0);
                      const disabled = savingId === it.id || deletingId === it.id;
                      return (
                        <tr key={it.id} className="border-b last:border-0">
                          <td className="py-2 pr-3">{idx + 1}</td>
                          <td className="py-2 pr-3">{it.kind}</td>
                          <td className="py-2 pr-3 max-w-xs">
                            <div className="truncate" title={it.description}>
                              {it.description}
                            </div>
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              className="w-16 rounded border px-1 py-0.5 text-xs"
                              value={it.unit}
                              onChange={(e) =>
                                updateLocalItem(it.id, "unit", e.target.value)
                              }
                              disabled={disabled}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              type="number"
                              className="w-20 rounded border px-1 py-0.5 text-xs"
                              value={it.quantity ?? 0}
                              onChange={(e) =>
                                updateLocalItem(
                                  it.id,
                                  "quantity",
                                  Number(e.target.value || 0)
                                )
                              }
                              disabled={disabled}
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <input
                              type="number"
                              step="0.01"
                              className="w-24 rounded border px-1 py-0.5 text-xs"
                              value={it.unitCost ?? 0}
                              onChange={(e) =>
                                updateLocalItem(
                                  it.id,
                                  "unitCost",
                                  Number(e.target.value || 0)
                                )
                              }
                              disabled={disabled}
                            />
                          </td>
                          <td className="py-2 pr-3 font-medium">
                            ${cost.toFixed(2)}
                          </td>
                          <td className="py-2 pr-3">
                            <label className="mr-2 inline-flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={!!it.isMaterial}
                                onChange={(e) =>
                                  updateLocalItem(
                                    it.id,
                                    "isMaterial",
                                    e.target.checked
                                  )
                                }
                                disabled={disabled}
                              />
                              M
                            </label>
                            <label className="inline-flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={!!it.isLabor}
                                onChange={(e) =>
                                  updateLocalItem(
                                    it.id,
                                    "isLabor",
                                    e.target.checked
                                  )
                                }
                                disabled={disabled}
                              />
                              L
                            </label>
                          </td>
                          <td className="py-2 pr-3 space-x-1 whitespace-nowrap text-xs">
                            <button
                              className="rounded border px-2 py-0.5"
                              onClick={() => handleSaveItem(it.id)}
                              disabled={disabled}
                            >
                              {savingId === it.id ? "Saving…" : "Save"}
                            </button>
                            <button
                              className="rounded border border-red-300 px-2 py-0.5 text-red-700"
                              onClick={() => handleDeleteItem(it.id)}
                              disabled={disabled}
                            >
                              {deletingId === it.id ? "Deleting…" : "Delete"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Totals */}
          <section className="rounded-lg border p-4">
            <h3 className="text-lg font-semibold mb-2">Totals (quick view)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-gray-500">Subtotal</div>
                <div>${totals.subtotal.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-500">Markup %</div>
                <div>{totals.markupPct.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-gray-500">Contingency %</div>
                <div>{totals.contingencyPct.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-gray-500">After Contingency</div>
                <div>${totals.afterContingency.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-500">Mobilization</div>
                <div>${totals.mobilization.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-500">Tax</div>
                <div>${totals.taxTotal.toFixed(2)}</div>
              </div>
              <div className="sm:col-span-2 pt-1 border-t">
                <div className="text-gray-500">Grand Total</div>
                <div className="text-base font-semibold">
                  ${totals.grand.toFixed(2)}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border p-4 text-xs text-gray-500">
            <div>
              Org Settings: {settings ? "loaded" : "—"} • Tax Scope:{" "}
              {tax ? "loaded" : "—"} • Tiers: {tiers.length}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
