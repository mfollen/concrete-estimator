"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

export default function BidPage({ params }: { params: { id: string } }) {
  const snapId = params.id;
  const [snap, setSnap] = useState<any | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [estimate, setEstimate] = useState<any | null>(null);
  const [project, setProject] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("EstimateSnapshot").select("*").eq("id", snapId).single();
      if (!s) return;
      setSnap(s);
      const { data: e } = await supabase.from("Estimate").select("*, project:projectId(*)").eq("id", s.estimateId).single();
      setEstimate(e);
      setProject(e?.project);
      if (e?.project?.orgId) {
        const { data: cfg } = await supabase.from("OrgSettings").select("*").eq("orgId", e.project.orgId).single();
        setSettings(cfg);
      }
    })();
  }, [snapId]);

  if (!snap) return <div>Loading…</div>;
  const data = snap.data || {};
  const logoUrl = settings?.logoUrl || "/logo.svg";

  return (
    <div className="printable">
      <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #e5e7eb",paddingBottom:12,marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {logoUrl?.startsWith("/") ? (
            <Image src={logoUrl} alt="Logo" width={180} height={36} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" style={{ height: 36 }}/>
          )}
          <div>
            <h1>Concrete Estimator</h1>
            <div style={{fontSize:12,color:"#6b7280"}}>{project?.name} — {estimate?.title}</div>
          </div>
        </div>
        <div style={{textAlign:"right", fontSize:12}}>
          <div>Version: {snap.version}</div>
          <div>Date: {new Date(snap.createdAt).toLocaleDateString()}</div>
          <div>Validity: {settings?.validityDays ?? 30} days</div>
        </div>
      </header>

      <section style={{marginBottom:16}}>
        <h2>Summary</h2>
        <table className="table" style={{width:"100%", fontSize:14}}>
          <tbody>
            <tr><td>Direct</td><td style={{textAlign:"right"}}>${fmt(data.totalDirect)}</td></tr>
            <tr><td>Overhead</td><td style={{textAlign:"right"}}>${fmt(data.totalOverhead)}</td></tr>
            <tr><td>Markup</td><td style={{textAlign:"right"}}>${fmt(data.totalMarkup)}</td></tr>
            {data.mobilization ? <tr><td>Mobilization</td><td style={{textAlign:"right"}}>${fmt(data.mobilization)}</td></tr> : null}
            <tr><td>Contingency</td><td style={{textAlign:"right"}}>${fmt(data.contingency ?? data.totalContingency)}</td></tr>
            <tr><td>Tax</td><td style={{textAlign:"right"}}>${fmt(data.tax ?? 0)}</td></tr>
            <tr><td><strong>Grand Total</strong></td><td style={{textAlign:"right"}}><strong>${fmt(data.grandTotal ?? data.grand)}</strong></td></tr>
          </tbody>
        </table>
      </section>

      <section style={{marginBottom:16}}>
        <h2>Line Items</h2>
        <table className="table" style={{width:"100%", fontSize:14}}>
          <thead><tr><th>Description</th><th style={{textAlign:"right"}}>Qty</th><th style={{textAlign:"right"}}>Unit</th><th style={{textAlign:"right"}}>Unit Cost</th><th style={{textAlign:"right"}}>Line Total</th></tr></thead>
          <tbody>
            {data.items?.map((i:any)=>(
              <tr key={i.id}>
                <td>{i.desc}</td>
                <td style={{textAlign:"right"}}>{i.qty}</td>
                <td style={{textAlign:"right"}}>{i.unit}</td>
                <td style={{textAlign:"right"}}>${fmt(i.unitCost)}</td>
                <td style={{textAlign:"right"}}>${fmt(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{display:"grid",gridTemplateColumns:"1fr 1fr", gap:16, fontSize:12}}>
        <div>
          <h3>Terms</h3>
          <p style={{whiteSpace:"pre-wrap"}}>{settings?.termsText ?? "Payment terms: Net 30 unless otherwise agreed."}</p>
          <h3 style={{marginTop:8}}>License / Bonding</h3>
          <p style={{whiteSpace:"pre-wrap"}}>{settings?.licenseText ?? "Licensed, bonded, and insured as required by jurisdiction."}</p>
        </div>
        <div>
          <h3>Exclusions</h3>
          <p style={{whiteSpace:"pre-wrap"}}>{settings?.exclusionsText ?? "Excludes permits, survey, testing, and unforeseen site conditions."}</p>
        </div>
      </section>

      <footer className="no-print" style={{marginTop:24, textAlign:"center"}}>
        <button className="button" onClick={()=>window.print()}>Print / Save PDF</button>
      </footer>
    </div>
  );
}

function fmt(n:number){ return Number(n||0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
