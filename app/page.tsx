"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Home() {
  const [emailSent, setEmailSent] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email ?? null;
      setSessionEmail(email);
    });
  }, []);

  if (!sessionEmail) {
    return (
      <div>
        <h1 className="text-xl" style={{marginBottom:12}}>Sign in to Concrete Estimator</h1>
        <form className="card" onSubmit={async (e) => {
          e.preventDefault();
          const email = (e.currentTarget as any).email.value as string;
          const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
          if (error) alert(error.message);
          else setEmailSent(email);
        }}>
          <div className="field">
            <label>Email</label>
            <input name="email" type="email" placeholder="you@company.com" required />
          </div>
          <button className="button" type="submit">Send Magic Link</button>
          {emailSent && <p style={{marginTop:8}}>Check your inbox: {emailSent}</p>}
        </form>
        <p style={{marginTop:16}}>No account needed; any email works for sign-in.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl" style={{marginBottom:12}}>Welcome, {sessionEmail}</h1>
      <div className="card">
        <p>Next steps:</p>
        <ol>
          <li>Open <a href="/settings">Settings</a> and click <strong>Initialize Demo Data</strong>.</li>
          <li>Return here to see your sample project and make a printable bid.</li>
        </ol>
      </div>
      <Projects />
    </div>
  );
}

function Projects() {
  const [projects, setProjects] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("Project").select("*").order("createdAt", { ascending: false });
      setProjects(data || []);
    })();
  }, []);

  if (!projects.length) return <p style={{marginTop:12}}>No projects yet. Go to <a href="/settings">Settings</a> and click <strong>Initialize Demo Data</strong>.</p>;
  return (
    <div style={{marginTop:16}}>
      <h2 className="text-lg" style={{marginBottom:8}}>Projects</h2>
      <table className="table">
        <thead><tr><th>Name</th><th>Client</th><th>Actions</th></tr></thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.clientName}</td>
              <td>
                <ProjectActions projectId={p.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectActions({ projectId }: { projectId: string }) {
  const [estimate, setEstimate] = useState<any | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("Estimate").select("*").eq("projectId", projectId).limit(1).maybeSingle();
      setEstimate(data);
    })();
  }, [projectId]);

  const createSnapshot = async () => {
    if (!estimate) return;
    const { data: items } = await supabase.from("EstimateItem").select("*").eq("estimateId", estimate.id);
    if (!items?.length) return alert("No items on this estimate.");

    const { data: project } = await supabase.from("Project").select("*, org:orgId(*)").eq("id", projectId).single();
    const orgId = project?.org?.id;
    const [{ data: settings }, { data: tax }, { data: tiers }] = await Promise.all([
      supabase.from("OrgSettings").select("*").eq("orgId", orgId).single(),
      supabase.from("TaxScope").select("*").eq("orgId", orgId).single(),
      supabase.from("MarkupTier").select("*").eq("orgId", orgId).order("rank", { ascending: true })
    ]);

    const calc = await import("../utils/estimate");
    const res = calc.totals({
      items: items.map((i:any) => ({
        quantity: i.quantity, unitCost: i.unitCost, markupPct: i.markupPct,
        isMaterial: i.isMaterial, isLabor: i.isLabor, isEquipment: i.isEquipment
      })),
      overheadPct: estimate.overheadPct,
      useMarkupTiers: settings?.useMarkupTiers ?? false,
      tiers: (tiers||[]).map((t:any)=>({minAmount: t.minAmount, maxAmount: t.maxAmount ?? undefined, percent: t.percent, rank: t.rank})),
      contingencyPct: settings?.defaultContingency ?? 5,
      contingencyOrder: (settings?.contingencyOrder ?? "AFTER_MARKUP"),
      taxRate: tax?.rate ?? 0,
      taxScope: {
        materials: !!tax?.taxMaterials,
        labor: !!tax?.taxLabor,
        equipment: !!tax?.taxEquipment,
        markup: !!tax?.taxMarkup,
        contingency: !!tax?.taxContingency
      },
      mobilization: { count: estimate.mobilizationCount ?? 0, price: settings?.mobilizationPrice ?? 3850 }
    });

    const payload = {
      estimateId: estimate.id,
      version: (Date.now() % 100000),
      data: {
        totalDirect: res.direct,
        totalOverhead: res.overhead,
        totalMarkup: res.markup,
        mobilization: res.mobilization,
        contingency: res.contingency,
        tax: res.tax,
        grandTotal: res.grand,
        items: items.map((i:any)=>({ id: i.id, kind: i.kind, desc: i.description, qty: i.quantity, unit: i.unit, unitCost: i.unitCost, lineTotal: i.quantity * i.unitCost }))
      }
    };

    const { data: snap, error } = await supabase.from("EstimateSnapshot").insert(payload).select("id").single();
    if (error) return alert(error.message);
    setSnapshotId(snap.id);
  };

  return (
    <div className="no-print">
      {estimate ? (
        <>
          <button className="button" onClick={createSnapshot}>Create Snapshot</button>
          {" "}
          {snapshotId && <a className="button secondary" href={`/b/${snapshotId}`} target="_blank">Open Printable Bid</a>}
        </>
      ) : <span>No estimate yet.</span>}
    </div>
  );
}
