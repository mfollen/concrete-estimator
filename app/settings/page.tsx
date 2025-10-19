"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function Settings() {
  const [org, setOrg] = useState<any | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [tax, setTax] = useState<any | null>(null);
  const [tiers, setTiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: me } = await supabase.auth.getUser();
      const userId = me.user?.id;
      if (!userId) { setLoading(false); return; }

      let { data: orgs } = await supabase.from("Membership").select("*, org:orgId(*)").eq("userId", userId);
      let currentOrg = orgs?.[0]?.org;

      if (!currentOrg) {
        const { data: newOrg, error: e1 } = await supabase.from("Org").insert({ name: "My Concrete Company" }).select("*").single();
        if (e1) { alert(e1.message); setLoading(false); return; }
        await supabase.from("Membership").insert({ orgId: newOrg.id, userId, role: "OWNER" });
        currentOrg = newOrg;
      }
      setOrg(currentOrg);

      const [{ data: s }, { data: t }, { data: mk }] = await Promise.all([
        supabase.from("OrgSettings").select("*").eq("orgId", currentOrg.id).maybeSingle(),
        supabase.from("TaxScope").select("*").eq("orgId", currentOrg.id).maybeSingle(),
        supabase.from("MarkupTier").select("*").eq("orgId", currentOrg.id).order("rank", { ascending: true })
      ]);

      if (!s) {
        await supabase.from("OrgSettings").insert({
          orgId: currentOrg.id, useMarkupTiers: true, defaultContingency: 5, contingencyOrder: "AFTER_MARKUP",
          mobilizationPrice: 3850, crewHoursPerDay: 8, logoUrl: "/logo.svg", validityDays: 30
        });
      }
      if (!t) {
        await supabase.from("TaxScope").insert({ orgId: currentOrg.id, rate: 0, taxMaterials: false, taxLabor: false, taxEquipment: false, taxMarkup: false, taxContingency: false });
      }
      const existingTiers = mk || [];
      if (!existingTiers.length) {
        await supabase.from("MarkupTier").insert([
          { orgId: currentOrg.id, minAmount: 0,      maxAmount: 10000, percent: 20, rank: 1 },
          { orgId: currentOrg.id, minAmount: 10000,  maxAmount: 50000, percent: 15, rank: 2 },
          { orgId: currentOrg.id, minAmount: 50000,  maxAmount: null,  percent: 10, rank: 3 }
        ]);
      }

      const [S, T, MK] = await Promise.all([
        supabase.from("OrgSettings").select("*").eq("orgId", currentOrg.id).single(),
        supabase.from("TaxScope").select("*").eq("orgId", currentOrg.id).single(),
        supabase.from("MarkupTier").select("*").eq("orgId", currentOrg.id).order("rank", { ascending: true })
      ]);

      setSettings(S.data); setTax(T.data); setTiers(MK.data||[]);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    if (!org || !settings || !tax) return;
    await supabase.from("OrgSettings").upsert(settings, { onConflict: "orgId" });
    await supabase.from("TaxScope").upsert({ orgId: org.id, ...tax }, { onConflict: "orgId" });
    await supabase.from("MarkupTier").delete().eq("orgId", org.id);
    const toInsert = tiers.map((t:any)=>({ ...t, id: undefined, orgId: org.id }));
    if (toInsert.length) await supabase.from("MarkupTier").insert(toInsert);
    alert("Saved!");
  };

  const initDemoProject = async () => {
    if (!org) return;
    const user = (await supabase.auth.getUser()).data.user;
    const { data: project } = await supabase.from("Project").insert({
      orgId: org.id, name: "Warehouse Expansion", clientName: "BigCo", location: "Joliet, IL", createdBy: user?.id
    }).select("*").single();
    const { data: estimate } = await supabase.from("Estimate").insert({
      projectId: project.id, title: "Base Bid", overheadPct: 10, createdBy: user?.id, mobilizationCount: 1
    }).select("*").single();
    await supabase.from("EstimateItem").insert([
      { estimateId: estimate.id, kind: "SLAB", description: "6\" slab on grade", unit: "SF", quantity: 20000, unitCost: 5.25, markupPct: 20, contingencyPct: 5, durationHours: 160, isMaterial: true, isLabor: true, isEquipment: true },
      { estimateId: estimate.id, kind: "FOOTING", description: "Strip footing 24\"x12\"", unit: "LF", quantity: 600, unitCost: 18.5, markupPct: 15, contingencyPct: 5, durationHours: 80, isMaterial: true, isLabor: true },
      { estimateId: estimate.id, kind: "WALL", description: "8\" formed wall", unit: "SF", quantity: 3000, unitCost: 15.0, markupPct: 12, contingencyPct: 5, durationHours: 120, isMaterial: true, isLabor: true }
    ]);
    alert("Demo project created! Go back to Home and create a snapshot.");
  };

  if (loading) return <div>Loading…</div>;
  if (!org || !settings || !tax) return <div>Something went wrong initializing settings.</div>;

  return (
    <div>
      <h1 className="text-xl" style={{marginBottom:12}}>Settings</h1>
      <div className="card" style={{marginBottom:16}}>
        <p><strong>Step 1:</strong> Click this to set up defaults and a demo project.</p>
        <button className="button" onClick={initDemoProject}>Initialize Demo Data</button>
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
