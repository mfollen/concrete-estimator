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
  description?: string | null;
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

// Template metadata for dropdown
type LineItemTemplate = {
  id: string;
  group: "SYSTEM" | "MATERIAL" | "LABOR";
  label: string;
  kind: string;
  description: string;
  unit: string;
  defaultQuantity: number;
  defaultUnitCost: number;
  isMaterial?: boolean;
  isLabor?: boolean;
  isEquipment?: boolean;
};

// Very lightweight set derived from your CSVs for MVP.
const LINE_ITEM_TEMPLATES: LineItemTemplate[] = [
  // --- System / turnkey items ---
  {
    id: "sys-sidewalk-4-9",
    group: "SYSTEM",
    label: 'Sidewalk 4" @ $9/SF',
    kind: "SIDEWALK",
    description: 'Sidewalk 4" @ $9/SF',
    unit: "SF",
    defaultQuantity: 100,
    defaultUnitCost: 9,
    isMaterial: true,
    isLabor: true,
  },
  {
    id: "sys-sidewalk-5-10",
    group: "SYSTEM",
    label: 'Sidewalk 5" @ $10/SF',
    kind: "SIDEWALK",
    description: 'Sidewalk 5" @ $10/SF',
    unit: "SF",
    defaultQuantity: 100,
    defaultUnitCost: 10,
    isMaterial: true,
    isLabor: true,
  },
  {
    id: "sys-sidewalk-6-11",
    group: "SYSTEM",
    label: 'Sidewalk 6" @ $11/SF',
    kind: "SIDEWALK",
    description: 'Sidewalk 6" @ $11/SF',
    unit: "SF",
    defaultQuantity: 100,
    defaultUnitCost: 11,
    isMaterial: true,
    isLabor: true,
  },
  {
    id: "sys-slab-4-950",
    group: "SYSTEM",
    label: 'Slab 4" @ $9.50/SF',
    kind: "SLAB",
    description: 'Slab 4" @ $9.50/SF',
    unit: "SF",
    defaultQuantity: 1000,
    defaultUnitCost: 9.5,
    isMaterial: true,
    isLabor: true,
  },
  {
    id: "sys-slab-6-10",
    group: "SYSTEM",
    label: 'Slab 6" @ $10/SF',
    kind: "SLAB",
    description: 'Slab 6" @ $10/SF',
    unit: "SF",
    defaultQuantity: 1000,
    defaultUnitCost: 10,
    isMaterial: true,
    isLabor: true,
  },
  {
    id: "sys-slab-8-12",
    group: "SYSTEM",
    label: 'Slab 8" @ $12/SF',
    kind: "SLAB",
    description: 'Slab 8" @ $12/SF',
    unit: "SF",
    defaultQuantity: 1000,
    defaultUnitCost: 12,
    isMaterial: true,
    isLabor: true,
  },
  {
    id: "sys-curb-6-35",
    group: "SYSTEM",
    label: '6" Curb @ $35/LF',
    kind: "CURB",
    description: '6" Curb @ $35/LF',
    unit: "LF",
    defaultQuantity: 200,
    defaultUnitCost: 35,
    isMaterial: true,
    isLabor: true,
  },
  {
    id: "sys-curb-gutter-38",
    group: "SYSTEM",
    label: "Curb & Gutter @ $38/LF",
    kind: "CURB",
    description: "Curb & Gutter @ $38/LF",
    unit: "LF",
    defaultQuantity: 200,
    defaultUnitCost: 38,
    isMaterial: true,
    isLabor: true,
  },

  // --- Materials ---
  {
    id: "mat-concrete-3000",
    group: "MATERIAL",
    label: "Concrete 3000 PSI (CY)",
    kind: "MATERIAL",
    description: "Concrete 3000 PSI",
    unit: "CY",
    defaultQuantity: 10,
    defaultUnitCost: 150,
    isMaterial: true,
  },
  {
    id: "mat-concrete-4000",
    group: "MATERIAL",
    label: "Concrete 4000 PSI (CY)",
    kind: "MATERIAL",
    description: "Concrete 4000 PSI",
    unit: "CY",
    defaultQuantity: 10,
    defaultUnitCost: 160,
    isMaterial: true,
  },
  {
    id: "mat-ca6-base-stone",
    group: "MATERIAL",
    label: "CA-6 Base Stone (TON)",
    kind: "MATERIAL",
    description: "CA-6 (Road/Base) Stone",
    unit: "TON",
    defaultQuantity: 10,
    defaultUnitCost: 30,
    isMaterial: true,
  },
  {
    id: "mat-rebar-installed-ton",
    group: "MATERIAL",
    label: "Rebar (Installed) per Ton",
    kind: "MATERIAL",
    description: "Rebar (Installed) per Ton",
    unit: "TON",
    defaultQuantity: 1,
    defaultUnitCost: 4000,
    isMaterial: true,
  },
  {
    id: "mat-wire-mesh-6x6-w2-9",
    group: "MATERIAL",
    label: "Wire Mesh 6x6 W2.9/W2.9 (SF)",
    kind: "MATERIAL",
    description: "Wire Mesh 6x6 W2.9/W2.9",
    unit: "SF",
    defaultQuantity: 1000,
    defaultUnitCost: 0.25,
    isMaterial: true,
  },
  {
    id: "mat-vapor-barrier-10mil",
    group: "MATERIAL",
    label: "Vapor Barrier 10 mil (SF)",
    kind: "MATERIAL",
    description: "Vapor Barrier 10 mil",
    unit: "SF",
    defaultQuantity: 1000,
    defaultUnitCost: 0.12,
    isMaterial: true,
  },
  {
    id: "mat-curing-compound",
    group: "MATERIAL",
    label: "Curing Compound (SF)",
    kind: "MATERIAL",
    description: "Curing Compound",
    unit: "SF",
    defaultQuantity: 1000,
    defaultUnitCost: 0.12,
    isMaterial: true,
  },
  {
    id: "mat-sealer",
    group: "MATERIAL",
    label: "Sealer (SF)",
    kind: "MATERIAL",
    description: "Sealer",
    unit: "SF",
    defaultQuantity: 1000,
    defaultUnitCost: 0.2,
    isMaterial: true,
  },

  // --- Labor ---
  {
    id: "lab-laborer",
    group: "LABOR",
    label: "Laborer @ $95/hr",
    kind: "LABOR",
    description: "Laborer",
    unit: "HR",
    defaultQuantity: 8,
    defaultUnitCost: 95,
    isLabor: true,
  },
  {
    id: "lab-finisher",
    group: "LABOR",
    label: "Finisher @ $95/hr",
    kind: "LABOR",
    description: "Finisher",
    unit: "HR",
    defaultQuantity: 8,
    defaultUnitCost: 95,
    isLabor: true,
  },
  {
    id: "lab-operator",
    group: "LABOR",
    label: "Operator @ $95/hr",
    kind: "LABOR",
    description: "Operator",
    unit: "HR",
    defaultQuantity: 8,
    defaultUnitCost: 95,
    isLabor: true,
  },
  {
    id: "lab-foreman",
    group: "LABOR",
    label: "Foreman @ $95/hr",
    kind: "LABOR",
    description: "Foreman",
    unit: "HR",
    defaultQuantity: 8,
    defaultUnitCost: 95,
    isLabor: true,
  },
];

export default function EstimatePage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;

  const [loading, setLoading] = useState(true);
  const [savingItems, setSavingItems] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [projectDraft, setProjectDraft] = useState({
    name: "",
    clientName: "",
    location: "",
    description: "",
  });

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [tax, setTax] = useState<TaxScope | null>(null);
  const [tiers, setTiers] = useState<MarkupTier[]>([]);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    LINE_ITEM_TEMPLATES[0]?.id ?? ""
  );

  // ----------------- Data load -----------------
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

        const proj = p as Project;
        setProject(proj);
        setProjectDraft({
          name: proj.name ?? "",
          clientName: proj.clientName ?? "",
          location: proj.location ?? "",
          description: proj.description ?? "",
        });

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

        // 3) Items via RPC (no ORDER BY in SQL; sort in JS)
        if (est?.id) {
          const { data: its, error: itsErr } = await supabase.rpc(
            "list_estimate_items",
            { p_estimate_id: est.id }
          );
          if (itsErr) throw itsErr;
          if (!isMounted) return;

          const sorted = ((its as any[]) ?? [])
            .slice()
            .sort((a, b) => {
              const ra = a?.rank ?? 0;
              const rb = b?.rank ?? 0;
              if (ra !== rb) return ra - rb;
              return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
            });

          setItems(sorted as EstimateItem[]);
        } else {
          if (!isMounted) return;
          setItems([]);
        }

        // 4) Settings / Tax / Tiers
        if (proj.orgId) {
          const [
            { data: s, error: sErr },
            { data: t, error: tErr },
            { data: tr, error: trErr },
          ] = await Promise.all([
            supabase
              .from("OrgSettings")
              .select("*")
              .eq("orgId", proj.orgId)
              .maybeSingle(),
            supabase
              .from("TaxScope")
              .select("*")
              .eq("orgId", proj.orgId)
              .maybeSingle(),
            supabase.from("MarkupTier").select("*").eq("orgId", proj.orgId),
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

  // ----------------- Project header save -----------------
  async function handleSaveProjectHeader() {
    if (!project) return;
    try {
      setSavingProject(true);
      setError(null);

      const { data, error: upErr } = await supabase
        .from("Project")
        .update({
          name: projectDraft.name,
          clientName: projectDraft.clientName || null,
          location: projectDraft.location || null,
          description: projectDraft.description || null,
        })
        .eq("id", project.id)
        .select("*")
        .maybeSingle();

      if (upErr) throw upErr;
      if (data) {
        setProject(data as Project);
      }
    } catch (err: any) {
      console.error("Save project header failed:", err);
      setError(err?.message ?? String(err));
    } finally {
      setSavingProject(false);
    }
  }

  // ----------------- Line-item helpers -----------------

  function nextRank(): number {
    if (!items.length) return 1;
    const maxRank = items.reduce(
      (max, it) => (it.rank != null && it.rank > max ? it.rank : max),
      0
    );
    return (maxRank || items.length) + 1;
  }

  function handleItemChange(
    index: number,
    field: keyof EstimateItem,
    value: any
  ) {
    setItems((prev) => {
      const copy = [...prev];
      const it = { ...copy[index] };
      (it as any)[field] = value;
      copy[index] = it;
      return copy;
    });
  }

  async function handleDeleteItem(item: EstimateItem) {
    if (!item.id) return;
    try {
      setSavingItems(true);
      const { error: delErr } = await supabase
        .from("EstimateItem")
        .delete()
        .eq("id", item.id);
      if (delErr) throw delErr;

      setItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (err: any) {
      console.error("Delete line item failed:", err);
      setError(err?.message ?? String(err));
    } finally {
      setSavingItems(false);
    }
  }

  async function handleSaveItems() {
    if (!estimate) return;
    try {
      setSavingItems(true);
      setError(null);

      const payload = items.map((it, idx) => ({
        id: it.id,
        estimateId: estimate.id,
        kind: it.kind,
        description: it.description,
        unit: it.unit,
        quantity: it.quantity ?? 0,
        unitCost: it.unitCost ?? 0,
        isMaterial: it.isMaterial ?? false,
        isLabor: it.isLabor ?? false,
        isEquipment: it.isEquipment ?? false,
        rank: it.rank ?? idx + 1,
      }));

      const { error: upErr } = await supabase
        .from("EstimateItem")
        .upsert(payload, { onConflict: "id" });
      if (upErr) throw upErr;
    } catch (err: any) {
      console.error("Save line items failed:", err);
      setError(err?.message ?? String(err));
    } finally {
      setSavingItems(false);
    }
  }

  function handleAddFromTemplate() {
    if (!estimate) {
      setError("Create an estimate before adding line items.");
      return;
    }
    const tpl = LINE_ITEM_TEMPLATES.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;

    const newItem: EstimateItem = {
      id: crypto.randomUUID(),
      estimateId: estimate.id,
      kind: tpl.kind,
      description: tpl.description,
      unit: tpl.unit,
      quantity: tpl.defaultQuantity,
      unitCost: tpl.defaultUnitCost,
      isMaterial: tpl.isMaterial ?? null,
      isLabor: tpl.isLabor ?? null,
      isEquipment: tpl.isEquipment ?? null,
      rank: nextRank(),
      markupPct: null,
      contingencyPct: null,
      durationHours: null,
    };

    setItems((prev) => [...prev, newItem]);
  }

  function handleAddBlankItem() {
    if (!estimate) {
      setError("Create an estimate before adding line items.");
      return;
    }
    const newItem: EstimateItem = {
      id: crypto.randomUUID(),
      estimateId: estimate.id,
      kind: "CUSTOM",
      description: "",
      unit: "EA",
      quantity: 1,
      unitCost: 0,
      isMaterial: null,
      isLabor: null,
      isEquipment: null,
      rank: nextRank(),
      markupPct: null,
      contingencyPct: null,
      durationHours: null,
    };
    setItems((prev) => [...prev, newItem]);
  }

  // ----------------- Totals -----------------
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

  // ----------------- Render -----------------
  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Build marker to confirm the new bundle is live */}
      <div className="text-xs text-gray-500 mb-2">
        Build marker: <strong>PROJECT-ESTIMATE-V8-PROJECT-EDIT</strong>
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
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 mb-4">
          {error}
        </div>
      )}

      {!loading && !error && project && (
        <div className="space-y-8">
          {/* Project header (editable) */}
          <section className="rounded-lg border p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">
                  Project name
                </label>
                <input
                  className="w-full border rounded px-2 py-1 text-lg font-bold"
                  value={projectDraft.name}
                  onChange={(e) =>
                    setProjectDraft((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                />
              </div>
              <button
                type="button"
                className="self-start bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
                onClick={handleSaveProjectHeader}
                disabled={savingProject}
              >
                {savingProject ? "Saving…" : "Save project"}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Client name
                </label>
                <input
                  className="w-full border rounded px-2 py-1"
                  value={projectDraft.clientName}
                  onChange={(e) =>
                    setProjectDraft((prev) => ({
                      ...prev,
                      clientName: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Location
                </label>
                <input
                  className="w-full border rounded px-2 py-1"
                  value={projectDraft.location}
                  onChange={(e) =>
                    setProjectDraft((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Project description
              </label>
              <textarea
                className="w-full border rounded px-2 py-1 text-sm"
                rows={3}
                value={projectDraft.description}
                onChange={(e) =>
                  setProjectDraft((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Scope notes, phasing, constraints, etc."
              />
            </div>

            <p className="text-xs text-gray-400 mt-1">
              Project ID: {project.id}
            </p>
          </section>

          {/* Estimate summary */}
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

          {/* Template picker + line item editor */}
          <section className="rounded-lg border p-4">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-1">Add from template</h3>
                <label className="block text-xs text-gray-500 mb-1">
                  Choose a system, material, or labor rate to insert a new row.
                </label>
                <select
                  className="w-full md:w-96 border rounded px-2 py-1 text-sm"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                >
                  <optgroup label="Systems (turnkey)">
                    {LINE_ITEM_TEMPLATES.filter(
                      (t) => t.group === "SYSTEM"
                    ).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Materials">
                    {LINE_ITEM_TEMPLATES.filter(
                      (t) => t.group === "MATERIAL"
                    ).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Labor">
                    {LINE_ITEM_TEMPLATES.filter(
                      (t) => t.group === "LABOR"
                    ).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="bg-blue-600 text-white text-sm px-3 py-2 rounded hover:bg-blue-700"
                  onClick={handleAddFromTemplate}
                >
                  Add line from template
                </button>
                <button
                  type="button"
                  className="border text-sm px-3 py-2 rounded hover:bg-gray-50"
                  onClick={handleAddBlankItem}
                >
                  Add blank line
                </button>
              </div>
            </div>

            <h3 className="text-lg font-semibold mb-2">Line Items</h3>
            {items.length === 0 ? (
              <div className="text-sm text-gray-600">
                No items yet. Use the buttons above to add rows.
              </div>
            ) : (
              <>
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
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => {
                        const cost =
                          (it.quantity ?? 0) * (it.unitCost ?? 0);
                        return (
                          <tr key={it.id} className="border-b last:border-0">
                            <td className="py-2 pr-3">{it.rank ?? idx + 1}</td>
                            <td className="py-2 pr-3">
                              <input
                                className="w-24 border rounded px-1 py-0.5"
                                value={it.kind}
                                onChange={(e) =>
                                  handleItemChange(idx, "kind", e.target.value)
                                }
                              />
                            </td>
                            <td className="py-2 pr-3">
                              <input
                                className="w-64 border rounded px-1 py-0.5"
                                value={it.description ?? ""}
                                onChange={(e) =>
                                  handleItemChange(
                                    idx,
                                    "description",
                                    e.target.value
                                  )
                                }
                              />
                            </td>
                            <td className="py-2 pr-3">
                              <input
                                className="w-14 border rounded px-1 py-0.5"
                                value={it.unit}
                                onChange={(e) =>
                                  handleItemChange(idx, "unit", e.target.value)
                                }
                              />
                            </td>
                            <td className="py-2 pr-3">
                              <input
                                type="number"
                                className="w-20 border rounded px-1 py-0.5 text-right"
                                value={it.quantity ?? 0}
                                onChange={(e) =>
                                  handleItemChange(
                                    idx,
                                    "quantity",
                                    Number(e.target.value || "0")
                                  )
                                }
                              />
                            </td>
                            <td className="py-2 pr-3">
                              <input
                                type="number"
                                step="0.01"
                                className="w-24 border rounded px-1 py-0.5 text-right"
                                value={it.unitCost ?? 0}
                                onChange={(e) =>
                                  handleItemChange(
                                    idx,
                                    "unitCost",
                                    Number(e.target.value || "0")
                                  )
                                }
                              />
                            </td>
                            <td className="py-2 pr-3 font-medium">
                              ${cost.toFixed(2)}
                            </td>
                            <td className="py-2 pr-3">
                              <label className="mr-2">
                                <input
                                  type="checkbox"
                                  className="mr-1"
                                  checked={!!it.isMaterial}
                                  onChange={(e) =>
                                    handleItemChange(
                                      idx,
                                      "isMaterial",
                                      e.target.checked
                                    )
                                  }
                                />
                                M
                              </label>
                              <label className="mr-2">
                                <input
                                  type="checkbox"
                                  className="mr-1"
                                  checked={!!it.isLabor}
                                  onChange={(e) =>
                                    handleItemChange(
                                      idx,
                                      "isLabor",
                                      e.target.checked
                                    )
                                  }
                                />
                                L
                              </label>
                              <label>
                                <input
                                  type="checkbox"
                                  className="mr-1"
                                  checked={!!it.isEquipment}
                                  onChange={(e) =>
                                    handleItemChange(
                                      idx,
                                      "isEquipment",
                                      e.target.checked
                                    )
                                  }
                                />
                                E
                              </label>
                            </td>
                            <td className="py-2 pr-3">
                              <button
                                type="button"
                                className="text-xs text-red-600 hover:underline"
                                onClick={() => handleDeleteItem(it)}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
                    onClick={handleSaveItems}
                    disabled={savingItems}
                  >
                    {savingItems ? "Saving…" : "Save line items"}
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Totals panel */}
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
