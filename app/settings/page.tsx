"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type Org = { id: string; name: string };

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [tax, setTax] = useState<any | null>(null);
  const [tiers, setTiers] = useState<any[]>([]);

  // These are used by the "Initialize Demo Data" button
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErrorText(null);

        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const user = auth.user;
        if (!user) throw new Error("You are not signed in.");

        // Get or create org + membership
        let orgId: string | null = null;
        const { data: mems, error: memErr } = await supabase
          .from("Membership")
          .select('"orgId"')
          .eq('"userId"', user.id);
        if (memErr) throw memErr;
        if (mems?.length) orgId = (mems as any[])[0].orgId;

        if (!orgId) {
          const { data: newOrg, error: orgErr } = await supabase
            .from("Org")
            .insert({ name: "My Concrete Company" })
            .select("id, name")
            .single();
          if (orgErr) throw orgErr;
          orgId = (newOrg as any).id as string;

          const { error: memInsErr } = await supabase
            .from("Membership")
            .insert({ orgId, userId: user.id, role: "OWNER" });
          if (memInsErr) throw memInsErr;
        }

        const { data: orgRow, error: orgLoadErr } = await supabase
          .from("Org")
          .select("id, name")
          .eq("id", orgId!)
          .single();
        if (orgLoadErr) throw orgLoadErr;
        setOrg(orgRow as Org);

        // Ensure defaults exist
        await ensureDefaults(orgId!);

        // Load for UI
        const [{ data: S }, { data: T }, { data: MK }] = await Promise.all([
          supabase.from("OrgSettings").select("*").eq('"orgId"', orgId!).single(),
          supabase.from("TaxScope").select("*").eq('"orgId"', orgId!).single(),
          supabase
            .from("MarkupTier")
            .select("*")
            .eq('"orgId"', orgId!)
            .order("rank", { ascending: true }),
        ]);

        setSettings(S);
        setTax(T);
        setTiers((MK || []) as any[]);
      } catch (e: any) {
        console.error(e);
        setErrorText(e?.message || "Unknown error while initializing settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ⬇️ Moved INSIDE the component so it can use setDemoStatus / setDemoBusy
  const initDemoProject = async (orgId: string) => {
    setDemoStatus(null);
    setDemoBusy(true);
    try {
      const { data: me, error: meErr } = await supabase.auth.getUser();
      if (meErr) throw meErr;
      const userId = me.user?.id;
      if (!userId) throw new Error("No signed-in user.");

      setDemoStatus("Creating project…");
      const { data: project, error: pErr } = await supabase
        .from("Project")
        .insert({
          orgId,
          name: "Warehouse Expansion",
          clientName: "BigCo",
          location: "Joliet, IL",
          createdBy: userId,
        })
        .select("*")
        .single();
      if (pErr) throw pErr;

      setDemoStatus("Creating estimate…");
      const { data: estimate, error: eErr } = await supabase
        .from("Estimate")
        .insert({
          projectId: (project as any).id,
          title: "Base Bid",
          overheadPct: 10,
          createdBy: userId,
          mobilizationCount: 1,
        })
        .select("*")
        .single();
      if (eErr) throw eErr;

      setDemoStatus("Adding sample items…");
      const { error: iErr } = await supabase.from("EstimateItem").insert([
        {
          estimateId: (estimate as any).id,
          kind: "SLAB",
          description: '6" slab on grade',
          unit: "SF",
          quantity: 20000,
          unitCost: 5.25,
          markupPct: 20,
          contingencyPct: 5,
          durationHours: 160,
          isMaterial: true,
          isLabor: true,
          isEquipment: true,
        },
        {
          estimateId: (estimate as any).id,
          kind: "FOOTING",
          description: 'Strip footing 24"x12"',
          unit: "LF",
          quantity: 600,
          unitCost: 18.5,
          markupPct: 15,
          contingencyPct: 5,
          durationHours: 80,
          isMaterial: true,
          isLabor: true,
        },
        {
          estimateId: (estimate as any).id,
          kind: "WALL",
          description: '8" formed wall',
          unit: "SF",
          quantity: 3000,
          unitCost: 15.0,
          markupPct: 12,
          contingencyPct: 5,
          durationHours: 120,
          isMaterial: true,
          isLabor: true,
        },
      ]);
      if (iErr) throw iErr;

      setDemoStatus("✅ Demo project created! Go to Home to see it.");
    } catch (err: any) {
      console.error("Init demo data failed:", err);
      setDemoStatus(`❌ Initialize Demo Data failed: ${err?.message || String(err)}`);
    } finally {
      setDemoBusy(false);
    }
  };

  const save = async () => {
    try {
      if (!org || !settings || !tax) return;
      await supabase.from("OrgSettings").upsert(settings, { onConflict: "orgId" });
      await supabase.from("TaxScope").upsert({ orgId: org.id, ...tax }, { onConflict: "orgId" });
      await supabase.from("MarkupTier").delete().eq('"orgId"', org.id);
      const toInsert = tiers.map((t: any) => ({ ...t, id: undefined, orgId: org.id }));
      if (toInsert.length) await supabase.from("MarkupTier").insert(toInsert);
      alert("Saved!");
    } catch (e: any) {
      alert(e?.message || "Save failed");
    }
  };

  if (loading) return <div className="container">Loading…</div>;
  if (errorText) return <div className="container">Error: {errorText}</div>;
  if (!org || !settings || !tax) return <div className="container">Could not load settings.</div>;

  return (
    <div className="container">
      <nav style={{ marginBottom: 16 }}>
        <a href="/" style={{ marginRight: 16 }}>Home</a>
        <a href="/settings">Settings</a>
      </nav>

      <h1 className="title">Settings</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <p><strong>Step 1:</strong> Click to create a demo project.</p>
        <button className="button" disabled={demoBusy} onClick={() => initDemoProject(org!.id)}>
          {demoBusy ? "Working…" : "Initialize Demo Data"}
        </button>
        {demoStatus && <p style={{ marginTop: 8 }}>{demoStatus}</p>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="text-lg">Branding</h2>
        <div className="field">
          <label>Logo URL</label>
          <input value={settings.logoUrl ?? ""} onChange={(e) => setSettings({ ...settings, logoUrl: e.target.value })} placeholder="/logo.svg" />
        </div>
        <div className="field">
          <label>License / Bonding</label>
          <textarea value={settings.licenseText ?? ""} onChange={(e) => setSettings({ ...settings, licenseText: e.target.value })} />
        </div>
        <div className="field">
          <label>Terms</label>
          <textarea value={settings.termsText ?? ""} onChange={(e) => setSettings({ ...settings, termsText: e.target.value })} />
        </div>
        <div className="field">
          <label>Exclusions</label>
          <textarea value={settings.exclusionsText ?? ""} onChange={(e) => setSettings({ ...settings, exclusionsText: e.target.value })} />
        </div>
        <div className="field">
          <label>Quote Validity (days)</label>
          <input type="number" value={settings.validityDays ?? 30} onChange={(e) => setSettings({ ...settings, validityDays: parseInt(e.target.value || "30", 10) })} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="text-lg">Cost behavior</h2>
        <div className="field">
          <label>Use markup tiers</label>
          <select value={settings.useMarkupTiers ? "true" : "false"} onChange={(e) => setSettings({ ...settings, useMarkupTiers: e.target.value === "true" })}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div className="field">
          <label>Contingency (%)</label>
          <input type="number" value={settings.defaultContingency ?? 5} onChange={(e) => setSettings({ ...settings, defaultContingency: parseFloat(e.target.value || "0") })} />
        </div>
        <div className="field">
          <label>Contingency order</label>
          <select value={settings.contingencyOrder} onChange={(e) => setSettings({ ...settings, contingencyOrder: e.target.value })}>
            <option value="AFTER_MARKUP">After markup</option>
            <option value="BEFORE_MARKUP">Before markup</option>
          </select>
        </div>
        <div className="field">
          <label>Mobilization price ($)</label>
          <input type="number" value={settings.mobilizationPrice ?? 3850} onChange={(e) => setSettings({ ...settings, mobilizationPrice: parseFloat(e.target.value || "0") })} />
        </div>
        <div className="field">
          <label>Crew hours per day</label>
          <input type="number" value={settings.crewHoursPerDay ?? 8} onChange={(e) => setSettings({ ...settings, crewHoursPerDay: parseInt(e.target.value || "8", 10) })} />
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg">Tax</h2>
        <div className="field"><label>Tax rate (%)</label><input type="number" value={tax.rate ?? 0} onChange={(e) => setTax({ ...tax, rate: parseFloat(e.target.value || "0") })} /></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxMaterials} onChange={(e) => setTax({ ...tax, taxMaterials: e.target.checked })} /> Materials</label></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxLabor} onChange={(e) => setTax({ ...tax, taxLabor: e.target.checked })} /> Labor</label></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxEquipment} onChange={(e) => setTax({ ...tax, taxEquipment: e.target.checked })} /> Equipment</label></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxMarkup} onChange={(e) => setTax({ ...tax, taxMarkup: e.target.checked })} /> Markup</label></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxContingency} onChange={(e) => setTax({ ...tax, taxContingency: e.target.checked })} /> Contingency</label></div>
      </div>

      <div className="card">
        <h2 className="text-lg">Markup tiers</h2>
        <table className="table">
          <thead><tr><th>Rank</th><th>Min ($)</th><th>Max ($)</th><th>Percent (%)</th><th></th></tr></thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={i}>
                <td><input type="number" value={t.rank} onChange={(e) => updateTier(i, { ...t, rank: parseInt(e.target.value || "0", 10) })} /></td>
                <td><input type="number" value={t.minAmount} onChange={(e) => updateTier(i, { ...t, minAmount: parseFloat(e.target.value || "0") })} /></td>
                <td><input type="number" value={t.maxAmount ?? ""} onChange={(e) => updateTier(i, { ...t, maxAmount: e.target.value === "" ? null : parseFloat(e.target.value) })} /></td>
                <td><input type="number" value={t.percent} onChange={(e) => updateTier(i, { ...t, percent: parseFloat(e.target.value || "0") })} /></td>
                <td><button className="button secondary" onClick={() => removeTier(i)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button className="button secondary" onClick={() => addTier()}>Add tier</button>{" "}
          <button className="button" onClick={save}>Save all</button>
        </div>
      </div>
    </div>
  );

  function addTier() {
    setTiers([
      ...tiers,
      { rank: (tiers.at(-1)?.rank ?? 0) + 1, minAmount: 0, maxAmount: null, percent: 10 },
    ]);
  }
  function removeTier(i: number) {
    setTiers(tiers.filter((_, idx) => idx !== i));
  }
  function updateTier(i: number, t: any) {
    const next = [...tiers];
    next[i] = t;
    setTiers(next);
  }
}

// --------- helpers outside component ---------
async function ensureDefaults(orgId: string) {
  await supabase.from("OrgSettings").upsert(
    {
      orgId,
      useMarkupTiers: true,
      defaultContingency: 5,
      contingencyOrder: "AFTER_MARKUP",
      mobilizationPrice: 3850,
      crewHoursPerDay: 8,
      logoUrl: "/logo.svg",
      validityDays: 30,
    },
    { onConflict: "orgId" }
  );

  await supabase.from("TaxScope").upsert(
    {
      orgId,
      rate: 0,
      taxMaterials: false,
      taxLabor: false,
      taxEquipment: false,
      taxMarkup: false,
      taxContingency: false,
    },
    { onConflict: "orgId" }
  );

  await supabase.from("MarkupTier").delete().eq('"orgId"', orgId);
  await supabase.from("MarkupTier").insert([
    { orgId, minAmount: 0, maxAmount: 10000, percent: 20, rank: 1 },
    { orgId, minAmount: 10000, maxAmount: 50000, percent: 15, rank: 2 },
    { orgId, minAmount: 50000, maxAmount: null, percent: 10, rank: 3 },
  ]);

  const rebar = [
    { size: "#3", lbft: 0.376 },
    { size: "#4", lbft: 0.668 },
    { size: "#5", lbft: 1.043 },
    { size: "#6", lbft: 1.502 },
    { size: "#7", lbft: 2.044 },
    { size: "#8", lbft: 2.670 },
  ];
  for (const r of rebar) {
    await supabase.from("RebarConversion").upsert(
      { orgId, barSize: r.size, poundsPerFoot: r.lbft },
      { onConflict: "orgId,barSize" } as any
    );
  }
}
