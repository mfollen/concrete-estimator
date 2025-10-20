"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Project = { id: string; name: string; orgId: string };

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = data.user;
        if (u?.id) {
          setUserId(u.id);
          await loadProjects(u.id);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function sendMagicLink() {
    setMsg(null);
    const redirectTo =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) setMsg(`Error: ${error.message}`);
    else setMsg("Check your email for the magic link.");
  }

  /** Load projects for ALL orgs this user belongs to. If none, create an org + membership. */
  async function loadProjects(uid: string) {
    // memberships
    const { data: mems, error: memErr } = await supabase
      .from("Membership")
      .select('"orgId"')
      .eq('"userId"', uid);
    if (memErr) throw memErr;

    let orgIds = (mems || []).map((m: any) => m.orgId as string);

    // create default org if none
    if (orgIds.length === 0) {
      const { data: newOrg, error: orgErr } = await supabase
        .from("Org")
        .insert({ name: "My Concrete Company" })
        .select("id")
        .single();
      if (orgErr) throw orgErr;
      const newOrgId = (newOrg as any).id as string;

      const { error: memInsErr } = await supabase
        .from("Membership")
        .insert({ orgId: newOrgId, userId: uid, role: "OWNER" });
      if (memInsErr) throw memInsErr;

      orgIds = [newOrgId];
    }

    // load projects across these orgs
    const { data: projs, error: pErr } = await supabase
      .from("Project")
      .select('id, name, "orgId"')
      .in('"orgId"', orgIds);
    if (pErr) throw pErr;

    setProjects((projs || []) as Project[]);
  }

  /** Create a snapshot for latest estimate & open printable bid */
  async function createSnapshot(project: Project) {
    try {
      setBusyProjectId(project.id);

      const { data: est, error: eErr } = await supabase
        .from("Estimate")
        .select('id, title, overheadPct, mobilizationCount, createdAt')
        .eq('"projectId"', project.id)
        .order("createdAt", { ascending: false })
        .limit(1)
        .single();
      if (eErr) throw eErr;

      const { data: items, error: iErr } = await supabase
        .from("EstimateItem")
        .select(
          'id, description, unit, quantity, unitCost, markupPct, contingencyPct, isMaterial, isLabor, isEquipment'
        )
        .eq('"estimateId"', (est as any).id);
      if (iErr) throw iErr;

      // org-level settings/tax/tiers
      const orgId = project.orgId;
      const [{ data: S }, { data: T }, { data: MK }] = await Promise.all([
        supabase.from("OrgSettings").select("*").eq('"orgId"', orgId).single(),
        supabase.from("TaxScope").select("*").eq('"orgId"', orgId).single(),
        supabase
          .from("MarkupTier")
          .select("*")
          .eq('"orgId"', orgId)
          .order("rank", { ascending: true }),
      ]);

      // simple math (safe defaults)
      const normItems = (items || []).map((it: any) => {
        const qty = Number(it.quantity || 0);
        const unitCost = Number(it.unitCost || 0);
        return {
          id: it.id,
          lineTotal: qty * unitCost,
          isMaterial: !!it.isMaterial,
          isLabor: !!it.isLabor,
          isEquipment: !!it.isEquipment,
        };
      });

      const subTotal = normItems.reduce((s: number, i: any) => s + i.lineTotal, 0);

      // markup tiers
      let markupPct = 0;
      if ((S as any)?.useMarkupTiers && (MK as any)?.length) {
        const amt = subTotal;
        let matched = false;
        for (const t of MK as any[]) {
          const min = Number((t as any).minAmount || 0);
          const max =
            (t as any).maxAmount === null ? Infinity : Number((t as any).maxAmount);
          if (amt >= min && amt < max) {
            markupPct = Number((t as any).percent || 0);
            matched = true;
            break;
          }
        }
        if (!matched && (MK as any[]).length > 0) {
          markupPct = Number(((MK as any[])[(MK as any[]).length - 1] as any).percent || 0);
        }
      } else {
        // fallback: 10%
        markupPct = 10;
      }
      const markupValue = (subTotal * markupPct) / 100;

      const contingencyPct = Number((S as any)?.defaultContingency || 5);
      const basePlusMarkup = subTotal + markupValue;
      const contingencyValue = (basePlusMarkup * contingencyPct) / 100;

      const taxableBase =
        ((T as any)?.taxMaterials
          ? normItems.filter((i: any) => i.isMaterial).reduce((s: number, i: any) => s + i.lineTotal, 0)
          : 0) +
        ((T as any)?.taxLabor
          ? normItems.filter((i: any) => i.isLabor).reduce((s: number, i: any) => s + i.lineTotal, 0)
          : 0) +
        ((T as any)?.taxEquipment
          ? normItems.filter((i: any) => i.isEquipment).reduce((s: number, i: any) => s + i.lineTotal, 0)
          : 0) +
        ((T as any)?.taxMarkup ? markupValue : 0) +
        ((T as any)?.taxContingency ? contingencyValue : 0);

      const taxRate = Number((T as any)?.rate || 0);
      const taxValue = (taxableBase * taxRate) / 100;

      const grandTotal = basePlusMarkup + contingencyValue + taxValue;

      const snapshotData = {
        items: normItems,
        subTotal,
        markupPct,
        markupValue,
        contingencyPct,
        contingencyValue,
        taxRate,
        taxValue,
        grandTotal,
      };

      const { data: snap, error: sErr } = await supabase
        .from("EstimateSnapshot")
        .insert({ estimateId: (est as any).id, version: 1, data: snapshotData })
        .select("id")
        .single();
      if (sErr) throw sErr;

      window.location.href = `/b/${(snap as any).id}`;
    } catch (err: any) {
      console.error("Create snapshot failed:", err);
      alert(`Create snapshot failed: ${err?.message || String(err)}`);
    } finally {
      setBusyProjectId(null);
    }
  }

  // ---------- UI ----------
  if (loading) return <div className="container">Loading…</div>;

  if (!userId) {
    return (
      <div className="container" style={{ maxWidth: 420 }}>
        <h1 className="title">Sign in to Concrete Estimator</h1>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
          Build marker: HOME-V2
        </div>
        <div className="card">
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <button className="button" onClick={sendMagicLink}>
            Send Magic Link
          </button>
          {msg && <p style={{ marginTop: 8 }}>{msg}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <nav style={{ marginBottom: 16 }}>
        <a href="/" style={{ marginRight: 16 }}>Home</a>
        <a href="/settings">Settings</a>
      </nav>

      <h1 className="title">Projects</h1>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
        Build marker: HOME-V2
      </div>

      {projects.length === 0 && (
        <div className="card">
          <p>No projects yet.</p>
          <p>
            Go to <a href="/settings">Settings</a> and click “Initialize Demo Data”.
          </p>
        </div>
      )}

      {projects.map((p) => (
        <div key={p.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{p.name}</strong>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Org: {p.orgId}</div>
            </div>
            <div>
              <button
                className="button"
                disabled={busyProjectId === p.id}
                onClick={() => createSnapshot(p)}
              >
                {busyProjectId === p.id ? "Working…" : "Create Snapshot"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
