"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type Org = { id: string; name: string };

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Org | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [tax, setTax] = useState<any | null>(null);
  const [tiers, setTiers] = useState<any[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErrorText(null);

        // 1) Who is signed in?
        const { data: auth } = await supabase.auth.getUser();
        const user = auth.user;
        if (!user) {
          setErrorText("You are not signed in. Go back to Home and sign in with your email.");
          setLoading(false);
          return;
        }

        // 2) Find an org for this user; if missing, create org + membership
        let orgId: string | null = null;

        // Try via Membership first
        const { data: mems, error: memErr } = await supabase
          .from("Membership")
          .select("orgId")
          .eq("userId", user.id);
        if (memErr) throw memErr;
        if (mems && mems.length) {
          orgId = mems[0].orgId;
        }

        if (!orgId) {
          // Create org
          const { data: newOrg, error: orgErr } = await supabase
            .from("Org")
            .insert({ name: "My Concrete Company" })
            .select("id, name")
            .single();
          if (orgErr) throw orgErr;

          orgId = newOrg.id;

          // Create membership
          const { error: memInsErr } = await supabase
            .from("Membership")
            .insert({ orgId, userId: user.id, role: "OWNER" });
          if (memInsErr) throw memInsErr;
        }

        // Load org record
        const { data: orgRow, error: orgLoadErr } = await supabase
          .from("Org")
          .select("id, name")
          .eq("id", orgId!)
          .single();
        if (orgLoadErr) throw orgLoadErr;
        setOrg(orgRow as Org);

        // 3) Ensure OrgSettings + TaxScope + MarkupTier + RebarConversion exist
        await ensureDefaults(orgId!);

        // 4) Load fresh
        const [{ data: S }, { data: T }, { data: MK }] = await Promise.all([
          supabase.from("OrgSettings").select("*").eq("orgId", orgId!).single(),
          supabase.from("TaxScope").select("*").eq("orgId", orgId!).single(),
          supabase.from("MarkupTier").select("*").eq("orgId", orgId!).order("rank", { ascending: true }),
        ]);

        setSettings(S);
        setTax(T);
        setTiers(MK || []);
      } catch (e: any) {
        console.error(e);
        setErrorText(e?.message || "Unknown error while initializing settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    try {
      if (!org || !settings || !tax) return;
      await supabase.from("OrgSettings").upsert(settings, { onConflict: "orgId" });
      await supabase.from("TaxScope").upsert({ orgId: org.id, ...tax }, { onConflict: "orgId" });
      await supabase.from("MarkupTier").delete().eq("orgId", org.id);
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
    <div>
      <h1 className="text-xl" style={{marginBottom:12}}>Settings</h1>

      <div className="card" style={{marginBottom:16}}>
        <p><strong>Step 1:</strong> Initialize demo data (project + estimate + sample items).</p>
        <button className="button" onClick={() => initDemoProject(org.id)}>Initialize Demo Data</button>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="text-lg">Branding</h2>
        <div className="field">
          <label>Logo URL</label>
          <input value={settings.logoUrl ?? ""} onChange={e=>setSettings({...settings, logoUrl: e.target.value})} placeholder="/logo.svg" />
        </div>
        <div className="field">
          <label>License / Bonding</label>
          <textarea value={settings.licenseText ?? ""} onChange={e=>setSettings({...settings, licenseText: e.target.value})} />
        </div>
        <div className="field">
          <label>Terms</label>
          <textarea value={settings.termsText ?? ""} onChange={e=>setSettings({...settings, termsText: e.target.value})} />
        </div>
        <div className="field">
          <label>Exclusions</label>
          <textarea value={settings.exclusionsText ?? ""} onChange={e=>setSettings({...settings, exclusionsText: e.target.value})} />
        </div>
        <div className="field">
          <label>Quote Validity (days)</label>
          <input type="number" value={settings.validityDays ?? 30} onChange={e=>setSettings({...settings, validityDays: parseInt(e.target.value||"30",10)})} />
        </div>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="text-lg">Cost behavior</h2>
        <div className="field">
          <label>Use markup tiers</label>
          <select value={settings.useMarkupTiers ? "true" : "false"} onChange={e=>setSettings({...settings, useMarkupTiers: e.target.value === "true"})}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div className="field">
          <label>Contingency (%)</label>
          <input type="number" value={settings.defaultContingency ?? 5} onChange={e=>setSettings({...settings, defaultContingency: parseFloat(e.target.value||"0")})} />
        </div>
        <div className="field">
          <label>Contingency order</label>
          <select value={settings.contingencyOrder} onChange={e=>setSettings({...settings, contingencyOrder: e.target.value})}>
            <option value="AFTER_MARKUP">After markup</option>
            <option value="BEFORE_MARKUP">Before markup</option>
          </select>
        </div>
        <div className="field">
          <label>Mobilization price ($)</label>
          <input type="number" value={settings.mobilizationPrice ?? 3850} onChange={e=>setSettings({...settings, mobilizationPrice: parseFloat(e.target.value||"0")})} />
        </div>
        <div className="field">
          <label>Crew hours per day</label>
          <input type="number" value={settings.crewHoursPerDay ?? 8} onChange={e=>setSettings({...settings, crewHoursPerDay: parseInt(e.target.value||"8",10)})} />
        </div>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="text-lg">Tax</h2>
        <div className="field"><label>Tax rate (%)</label><input type="number" value={tax.rate ?? 0} onChange={e=>setTax({...tax, rate: parseFloat(e.target.value||"0")})} /></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxMaterials} onChange={e=>setTax({...tax, taxMaterials: e.target.checked})}/> Materials</label></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxLabor} onChange={e=>setTax({...tax, taxLabor: e.target.checked})}/> Labor</label></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxEquipment} onChange={e=>setTax({...tax, taxEquipment: e.target.checked})}/> Equipment</label></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxMarkup} onChange={e=>setTax({...tax, taxMarkup: e.target.checked})}/> Markup</label></div>
        <div className="field"><label><input type="checkbox" checked={!!tax.taxContingency} onChange={e=>setTax({...tax, taxContingency: e.target.checked})}/> Contingency</label></div>
      </div>

      <div className="card">
        <h2 className="text-lg">Markup tiers</h2>
        <table className="table">
          <thead><tr><th>Rank</th><th>Min ($)</th><th>Max ($)</th><th>Percent (%)</th><th></th></tr></thead>
          <tbody>
            {tiers.map((t, i)=>(
              <tr key={i}>
                <td><input type="number" value={t.rank} onChange={e=>updateTier(i,{...t, rank: parseInt(e.target.value||"0",10)})} /></td>
                <td><input type="number" value={t.minAmount} onChange={e=>updateTier(i,{...t, minAmount: parseFloat(e.target.value||"0")})} /></td>
                <td><input type="number" value={t.maxAmount ?? ""} onChange={e=>updateTier(i,{...t, maxAmount: e.target.value===""? null : parseFloat(e.target.value)})} /></td>
                <td><input type="number" value={t.percent} onChange={e=>updateTier(i,{...t, percent: parseFloat(e.target.value||"0")})} /></td>
                <td><button className="button secondary" onClick={()=>removeTier(i)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{marginTop:8}}>
          <button className="button secondary" onClick={()=>addTier()}>Add tier</button>
          {" "}
          <button className="button" onClick={save}>Save all</button>
        </div>
      </div>
    </div>
  );

  function addTier(){ setTiers([...tiers, { rank: (tiers.at(-1)?.rank ?? 0)+1, minAmount: 0, maxAmount: null, percent: 10 }]); }
  function removeTier(i:number){ setTiers(tiers.filter((_,idx)=>idx!==i)); }
  function updateTier(i:number, t:any){ const next=[...tiers]; next[i]=t; setTiers(next); }
}

async function ensureDefaults(orgId: string) {
  // Settings
  await supabase.from("OrgSettings").upsert({
    orgId, useMarkupTiers: true, defaultContingency: 5, contingencyOrder: "AFTER_MARKUP",
    mobilizationPrice: 3850, crewHoursPerDay: 8, logoUrl: "/logo.svg", validityDays: 30
  }, { onConflict: "orgId" });

  // Tax
  await supabase.from("TaxScope").upsert({
    orgId, rate: 0, taxMaterials: false, taxLabor: false, taxEquipment: false, taxMarkup: false, taxContingency: false
  }, { onConflict: "orgId" });

  // Tiers (idempotent: delete & insert)
  await supabase.from("MarkupTier").delete().eq("orgId", orgId);
  await supabase.from("MarkupTier").insert([
    { orgId, minAmount: 0,      maxAmount: 10000, percent: 20, rank: 1 },
    { orgId, minAmount: 10000,  maxAmount: 50000, percent: 15, rank: 2 },
    { orgId, minAmount: 50000,  maxAmount: null,  percent: 10, rank: 3 }
  ]);

  // Rebar conversions (upsert)
  const rebar = [
    { size: "#3", lbft: 0.376 }, { size: "#4", lbft: 0.668 }, { size: "#5", lbft: 1.043 },
    { size: "#6", lbft: 1.502 }, { size: "#7", lbft: 2.044 }, { size: "#8", lbft: 2.670 },
  ];
  for (const r of rebar) {
    await supabase.from("RebarConversion").upsert(
      { orgId, barSize: r.size, poundsPerFoot: r.lbft },
      { onConflict: "orgId,barSize" } as any
    );
  }
}

async function initDemoProject(orgId: string) {
  const { data: me } = await supabase.auth.getUser();
  const userId = me.user?.id;

  const { data: project } = await supabase.from("Project").insert({
    orgId, name: "Warehouse Expansion", clientName: "BigCo", location: "Joliet, IL", createdBy: userId
  }).select("*").single();

  const { data: estimate } = await supabase.from("Estimate").insert({
    projectId: project.id, title: "Base Bid", overheadPct: 10, createdBy: userId, mobilizationCount: 1
  }).select("*").single();

  await supabase.from("EstimateItem").insert([
    { estimateId: estimate.id, kind: "SLAB", description: "6\" slab on grade", unit: "SF", quantity: 20000, unitCost: 5.25, markupPct: 20, contingencyPct: 5, durationHours: 160, isMaterial: true, isLabor: true, isEquipment: true },
    { estimateId: estimate.id, kind: "FOOTING", description: "Strip footing 24\"x12\"", unit: "LF", quantity: 600, unitCost: 18.5, markupPct: 15, contingencyPct: 5, durationHours: 80, isMaterial: true, isLabor: true },
    { estimateId: estimate.id, kind: "WALL", description: "8\" formed wall", unit: "SF", quantity: 3000, unitCost: 15.0, markupPct: 12, contingencyPct: 5, durationHours: 120, isMaterial: true, isLabor: true }
  ]);

  alert("Demo project created! Go back to Home and create a snapshot.");
}
