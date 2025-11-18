"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

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
  isEquipment?: boolean | null;
  rank?: number | null;
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

        // 3) Estimate items — NO SQL ORDER BY "rank" (we sort in JS)
        if (est?.id) {
          const { data: its, error: itsErr } = await supabase
            .from("EstimateItem")
            .select("*")
            .eq("estimateId", est.id);
          if (itsErr) throw itsErr;
          if (!isMounted) return;

          const sorted = ((its as any[]) ?? [])
            .slice()
            .sort((a, b) => {
              const ra =
                a?.rank == null ? Number.MAX_SAFE_INTEGER : (a.rank as number);
              const rb =
                b?.rank == null ? Number.MAX_SAFE_INTEGER : (b.rank as number);
              if (ra !== rb) return ra - rb;
              // stable tiebreaker by id
              return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
            });

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

  const totals = useMemo(() => {
    const subtotal = items.reduce(
      (sum, it) => sum + (it.quantity ?? 0) * (it.unitCost ?? 0),
      0
    );

    const markupPct =
      settings?.useMarkupTiers && tiers.length > 0
        ? (() => {
            const tier = tiers.find(
              (t) =>
                subtotal >= t.minAmount &&
                (t.maxAmount == null || subtotal < t.maxAmount)
            );
            return (tier?.percent ?? 0) / 100;
          })()
        : (estimate?.markupPct ?? 0) / 100;

    const contingencyPct =
      (estimate?.contingencyPct ?? settings?.defaultContingency ?? 0) / 100;

    const afterMarkup = subtotal + subtotal * markupPct;
    const afterContingency =
      settings?.contingencyOrder === "BEFORE_MARKUP"
        ? subtotal + subtotal * contingencyPct + subtotal * markupPct
        : afterMarkup + afterMarkup * contingencyPct;

    const mobilization =
      (settings?.mobilizationPrice ?? 0) * (estimate?.mobilizationCount ?? 0);

    const taxRate = (tax?.rate ?? 0) / 100;
    const taxable =
      tax?.taxMaterials ||
      tax?.taxLabor ||
      tax?.taxEquipment ||
      tax?.taxMarkup ||
      tax?.taxContingency
        ? afterContingency
        : 0;

    const taxTotal = taxable * taxRate;
    const grand = afterContingency + mobilization + taxTotal;

    return {
      subtotal,
      markupPct: markupPct * 100,
      contingencyPct: contingencyPct * 100,
      afterContingency,
      mobilization,
      taxTotal,
      grand,
    };
  }, [items, estimate, settings, tax, tiers]);

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Build marker to confirm the new bundle is live */}
      <div className="text-xs text-gray-500 mb-2">
        Build marker: <strong>PROJECT-ESTIMATE-V5-NORANK</strong>
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

          <section className="rounded-lg border p-4">
            <h3 className="text-lg font-semibold mb-2">Line Items</h3>
            {items.length === 0 ? (
              <div className="text-sm text-gray-600">No items yet.</div>
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
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const cost = (it.quantity ?? 0) * (it.unitCost ?? 0);
                      return (
                        <tr key={it.id} className="border-b last:border-0">
                          <td className="py-2 pr-3">{it.rank ?? idx + 1}</td>
                          <td className="py-2 pr-3">{it.kind}</td>
                          <td className="py-2 pr-3">{it.description}</td>
                          <td className="py-2 pr-3">{it.unit}</td>
                          <td className="py-2 pr-3">{it.quantity}</td>
                          <td className="py-2 pr-3">
                            ${(it.unitCost ?? 0).toFixed(2)}
                          </td>
                          <td className="py-2 pr-3 font-medium">
                            ${cost.toFixed(2)}
                          </td>
                          <td className="py-2 pr-3">
                            {(it.isMaterial ? "M" : "") +
                              (it.isLabor ? " L" : "") +
                              (it.isEquipment ? " E" : "")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

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
