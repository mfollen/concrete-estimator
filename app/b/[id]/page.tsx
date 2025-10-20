"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import {
  lineSubtotal,
  withMarkupAndContingency,
  addMobilization,
  applyTax,
  MarkupTier,
  round2,
} from "../../../utils/estimate";

type Project = {
  id: string;
  name: string;
  orgId: string;
  createdat: string;
};

type Estimate = {
  id: string;
  projectId: string;
  title: string;
  overheadPct: number | null;
  mobilizationCount: number | null;
  overtimeHoursPerDay: number | null;
  createdBy: string | null;
};

type EstimateItem = {
  id: string;
  estimateId: string;
  kind: "SLAB" | "FOOTING" | "WALL" | "OTHER";
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  markupPct: number; // used only when tiers are OFF
  contingencyPct: number;
  durationHours: number | null;
  isMaterial: boolean;
  isLabor: boolean;
  isEquipment: boolean;
};

type OrgSettings = {
  orgId: string;
  useMarkupTiers: boolean;
  defaultContingency: number | null;
  contingencyOrder: "AFTER_MARKUP" | "BEFORE_MARKUP";
  mobilizationPrice: number;
  mobilizationAutoPerCrewDay: boolean;
  crewHoursPerDay: number;
  logoUrl: string | null;
  validityDays: number | null;
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

export default function BidPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const search = useSearchParams();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);
  const [tiers, setTiers] = useState<MarkupTier[]>([]);
  const [taxScope, setTaxScope] = useState<TaxScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addForm, setAddForm] = useState({
    kind: "OTHER",
    description: "",
    unit: "EA",
    quantity: 1,
    unitCost: 1,
    markupPct: 0,
    contingencyPct: 0,
  });

  // Load everything (project, estimate, items, org settings, tiers, tax)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      setLoading(true);
      try {
        // Ensure user is signed in
        const { data: me, error: meErr } = await supabase.auth.getUser();
        if (meErr) throw meErr;
        if (!me.user) {
          // bounce to home
          router.push("/");
          return;
        }

        // 1) Project
        const { data: p, error: pErr } = await supabase
          .from<Project>("Project")
          .select("*")
          .eq("id", projectId)
          .maybeSingle();
        if (pErr) throw pErr;
        if (!p) throw new Error("Project not found");
        if (!cancelled) setProject(p);

        // 2) Org settings, tiers, tax
        const [{ data: s, error: sErr }, { data: t, error: tErr }, { data: tax, error: taxErr }] =
          await Promise.all([
            supabase.from<OrgSettings>("OrgSettings").select("*").eq("orgId", p.orgId).maybeSingle(),
            supabase
              .from<MarkupTier>("MarkupTier")
              .select("*")
              .eq("orgId", p.orgId)
              .order("rank", { ascending: true }),
            supabase.from<TaxScope>("TaxScope").select("*").eq("orgId", p.orgId).maybeSingle(),
          ]);
        if (sErr) throw sErr;
        if (tErr) throw tErr;
        if (taxErr) throw taxErr;
        if (!cancelled) {
          setOrgSettings(s ?? null);
          setTiers(t ?? []);
          setTaxScope(tax ?? null);
        }

        // 3) Estimate (assume 1 per project in MVP)
        const { data: e, error: eErr } = await supabase
          .from<Estimate>("Estimate")
          .select("*")
          .eq("projectId", p.id)
          .order("createdat", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (eErr) throw eErr;
        if (!e) {
          // No estimate yet – create one
          const { data: created, error: cErr } = await supabase
            .from<Estimate>("Estimate")
            .insert({
              projectId: p.id,
              title: "Base Bid",
              overheadPct: 0,
              mobilizationCount: 1,
              overtimeHoursPerDay: 0,
              createdBy: me.user.id,
            } as any)
            .select("*")
            .single();
          if (cErr) throw cErr;
          if (!cancelled) setEstimate(created);
        } else {
          if (!cancelled) setEstimate(e);
        }

        // 4) Items
        const estId = (e?.id) || (await supabase.from("Estimate").select("id").eq("projectId", p.id).single()).data.id;
        const { data: it, error: itErr } = await supabase
          .from<EstimateItem>("EstimateItem")
          .select("*")
          .eq("estimateId", estId)
          .order("createdat", { ascending: true });
        if (itErr) throw itErr;
        if (!cancelled) setItems(it ?? []);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, router]);

  // Totals
  const totals = useMemo(() => {
    if (!orgSettings) return null;
    const useTiers = !!orgSettings.useMarkupTiers;
    const contingencyOrder = orgSettings.contingencyOrder || "AFTER_MARKUP";

    // per-line calcs & breakdown
    let materials = 0, labor = 0, equipment = 0, markupAcc = 0, contingencyAcc = 0, other = 0;
    let linesTotal = 0;

    for (const li of items) {
      const base = lineSubtotal(li.quantity, li.unitCost);
      const res = withMarkupAndContingency(base, {
        useMarkupTiers: useTiers,
        tiers,
        lineMarkupPct: li.markupPct || 0,
        contingencyPct: li.contingencyPct || 0,
        contingencyOrder,
      });

      // naive flags to drive tax breakdown
      if (li.isMaterial) materials += base;
      if (li.isLabor) labor += base;
      if (li.isEquipment) equipment += base;
      // we can’t perfectly split markup/contingency per category without more modeling;
      // for tax purposes we track them globally
      markupAcc += res.markup;
      contingencyAcc += res.contingency;

      linesTotal += res.total;
    }

    // Mobilization
    const mobRes = addMobilization(
      linesTotal,
      orgSettings.mobilizationPrice || 0,
      estimate?.mobilizationCount || 0
    );

    // Tax
    const taxRes = applyTax(mobRes.totalWithMobilization, {
      rate: taxScope?.rate || 0,
      taxMaterials: !!taxScope?.taxMaterials,
      taxLabor: !!taxScope?.taxLabor,
      taxEquipment: !!taxScope?.taxEquipment,
      taxMarkup: !!taxScope?.taxMarkup,
      taxContingency: !!taxScope?.taxContingency,
      taxableBreakdown: {
        materials: round2(materials),
        labor: round2(labor),
        equipment: round2(equipment),
        markup: round2(markupAcc),
        contingency: round2(contingencyAcc),
        other: round2(other),
      },
    });

    return {
      linesTotal: round2(linesTotal),
      mobilization: mobRes.mobilization,
      tax: taxRes.tax,
      grandTotal: taxRes.totalWithTax,
    };
  }, [items, orgSettings, tiers, estimate?.mobilizationCount, taxScope]);

  async function addItem() {
    if (!estimate) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        estimateId: estimate.id,
        kind: addForm.kind as any,
        description: addForm.description || "New item",
        unit: addForm.unit,
        quantity: Number(addForm.quantity) || 1,
        unitCost: Number(addForm.unitCost) || 1,
        markupPct: Number(addForm.markupPct) || 0,
        contingencyPct: Number(addForm.contingencyPct) || 0,
        durationHours: 0,
        isMaterial: true,
        isLabor: true,
        isEquipment: false,
      } satisfies Partial<EstimateItem> as any;

      const { data, error: err } = await supabase
        .from<EstimateItem>("EstimateItem")
        .insert(payload)
        .select("*")
        .single();
      if (err) throw err;
      setItems((cur) => [...cur, data]);
      setAddForm({
        kind: "OTHER",
        description: "",
        unit: "EA",
        quantity: 1,
        unitCost: 1,
        markupPct: 0,
        contingencyPct: 0,
      });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(id: string, patch: Partial<EstimateItem>) {
    setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error: err } = await supabase.from("EstimateItem").update(patch).eq("id", id);
    if (err) {
      // revert on error
      await reloadItems();
      alert("Save failed: " + err.message);
    }
  }

  async function deleteItem(id: string) {
    const old = items;
    setItems((cur) => cur.filter((x) => x.id !== id));
    const { error } = await supabase.from("EstimateItem").delete().eq("id", id);
    if (error) {
      setItems(old);
      alert("Delete failed: " + error.message);
    }
  }

  async function reloadItems() {
    if (!estimate) return;
    const { data, error } = await supabase
      .from<EstimateItem>("EstimateItem")
      .select("*")
      .eq("estimateId", estimate.id)
      .order("createdat", { ascending: true });
    if (!error) setItems(data || []);
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!project || !estimate) return <div className="p-6">Not found.</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-blue-600 underline">Home</Link>
          <div className="text-xs opacity-60">Build marker: BID-V1</div>
          <h1 className="text-2xl font-semibold mt-1">{project.name}</h1>
          <div className="text-sm opacity-70">{estimate.title}</div>
        </div>
        <div className="text-right">
          <div className="text-sm opacity-60">Grand Total</div>
          <div className="text-3xl font-bold">${totals ? totals.grandTotal.toLocaleString() : "-"}</div>
          <div className="text-xs opacity-60">
            Lines: ${totals?.linesTotal.toLocaleString()} • Mob: ${totals?.mobilization.toLocaleString()} • Tax: ${totals?.tax.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Add Line Item */}
      <div className="border rounded-lg p-4">
        <div className="font-medium mb-2">Add Line Item</div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <select
            className="border rounded px-2 py-1"
            value={addForm.kind}
            onChange={(e) => setAddForm((f) => ({ ...f, kind: e.target.value }))}
          >
            <option>SLAB</option>
            <option>FOOTING</option>
            <option>WALL</option>
            <option>OTHER</option>
          </select>
          <input
            className="border rounded px-2 py-1 md:col-span-2"
            placeholder="Description"
            value={addForm.description}
            onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
          />
          <select
            className="border rounded px-2 py-1"
            value={addForm.unit}
            onChange={(e) => setAddForm((f) => ({ ...f, unit: e.target.value }))}
          >
            <option>EA</option><option>SF</option><option>LF</option><option>CY</option>
          </select>
          <input
            type="number" className="border rounded px-2 py-1"
            value={addForm.quantity}
            onChange={(e) => setAddForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
          />
          <input
            type="number" className="border rounded px-2 py-1"
            value={addForm.unitCost}
            onChange={(e) => setAddForm((f) => ({ ...f, unitCost: Number(e.target.value) }))}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mt-2">
          <input
            type="number" className="border rounded px-2 py-1"
            placeholder="Markup %"
            value={addForm.markupPct}
            onChange={(e) => setAddForm((f) => ({ ...f, markupPct: Number(e.target.value) }))}
            disabled={orgSettings?.useMarkupTiers}
          />
          <input
            type="number" className="border rounded px-2 py-1"
            placeholder="Contingency %"
            value={addForm.contingencyPct}
            onChange={(e) => setAddForm((f) => ({ ...f, contingencyPct: Number(e.target.value) }))}
          />
          <div className="md:col-span-3" />
          <button
            className="border rounded px-3 py-1 bg-black text-white disabled:opacity-60"
            onClick={addItem}
            disabled={saving}
          >
            {saving ? "Adding…" : "Add Item"}
          </button>
        </div>
        {orgSettings?.useMarkupTiers && (
          <div className="text-xs mt-2 opacity-60">
            Markup tiers ON. Per-line “Markup %” is ignored.
          </div>
        )}
      </div>

      {/* Items table */}
      <div className="overflow-x-auto">
        <table className="min-w-full border rounded-lg">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Kind</th>
              <th className="text-left p-2">Description</th>
              <th className="text-right p-2">Qty</th>
              <th className="text-right p-2">Unit</th>
              <th className="text-right p-2">Unit Cost</th>
              <th className="text-right p-2">Markup %</th>
              <th className="text-right p-2">Cont. %</th>
              <th className="text-right p-2">Line Total</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((li) => {
              const base = lineSubtotal(li.quantity, li.unitCost);
              const res = withMarkupAndContingency(base, {
                useMarkupTiers: !!orgSettings?.useMarkupTiers,
                tiers,
                lineMarkupPct: li.markupPct || 0,
                contingencyPct: li.contingencyPct || 0,
                contingencyOrder: orgSettings?.contingencyOrder || "AFTER_MARKUP",
              });

              return (
                <tr key={li.id} className="border-t">
                  <td className="p-2">{li.kind}</td>
                  <td className="p-2">
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={li.description}
                      onChange={(e) => updateItem(li.id, { description: e.target.value })}
                    />
                  </td>
                  <td className="p-2 text-right">
                    <input
                      type="number"
                      className="border rounded px-2 py-1 w-24 text-right"
                      value={li.quantity}
                      onChange={(e) => updateItem(li.id, { quantity: Number(e.target.value) })}
                    />
                  </td>
                  <td className="p-2 text-right">
                    <input
                      className="border rounded px-2 py-1 w-20 text-right"
                      value={li.unit}
                      onChange={(e) => updateItem(li.id, { unit: e.target.value })}
                    />
                  </td>
                  <td className="p-2 text-right">
                    <input
                      type="number"
                      className="border rounded px-2 py-1 w-28 text-right"
                      value={li.unitCost}
                      onChange={(e) => updateItem(li.id, { unitCost: Number(e.target.value) })}
                    />
                  </td>
                  <td className="p-2 text-right">
                    <input
                      type="number"
                      className="border rounded px-2 py-1 w-24 text-right disabled:opacity-50"
                      value={li.markupPct}
                      onChange={(e) => updateItem(li.id, { markupPct: Number(e.target.value) })}
                      disabled={!!orgSettings?.useMarkupTiers}
                    />
                  </td>
                  <td className="p-2 text-right">
                    <input
                      type="number"
                      className="border rounded px-2 py-1 w-24 text-right"
                      value={li.contingencyPct}
                      onChange={(e) => updateItem(li.id, { contingencyPct: Number(e.target.value) })}
                    />
                  </td>
                  <td className="p-2 text-right font-medium">${res.total.toLocaleString()}</td>
                  <td className="p-2 text-right">
                    <button
                      className="text-red-600 underline"
                      onClick={() => deleteItem(li.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {!items.length && (
              <tr>
                <td className="p-4 text-center opacity-60" colSpan={9}>
                  No items yet. Add your first line above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer totals */}
      <div className="border rounded-lg p-4 text-right">
        <div>Subtotal (lines): <b>${totals?.linesTotal.toLocaleString()}</b></div>
        <div>Mobilization: <b>${totals?.mobilization.toLocaleString()}</b></div>
        <div>Tax: <b>${totals?.tax.toLocaleString()}</b></div>
        <div className="text-xl mt-1">Grand Total: <b>${totals?.grandTotal.toLocaleString()}</b></div>
      </div>
    </div>
  );
}
