"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/** Small helpers */
function money(n: number) {
  return `$${(Math.round((n ?? 0) * 100) / 100).toLocaleString()}`;
}

type Project = { id: string; name: string; orgId: string };

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      if (u?.id) {
        setUserId(u.id);
        await ensureOrgsAndLoad(u.id);
      }
      setLoading(false);
    })();
  }, []);

  /** Send magic link */
  async function sendMagicLink() {
    setMsg(null);
    const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) setMsg(`Error: ${error.message}`);
    else setMsg("Check your email for the magic link.");
  }

  /** Ensures at least one org and loads all projects for all orgs the user belongs to */
  async function ensureOrgsAndLoad(uid: string) {
    // memberships
    let { data: mems, error: memErr } = await supabase
      .from("Membership")
      .select('"orgId"')
      .eq('"userId"', uid);
    if (memErr) throw memErr;

    let orgs = (mems || []).map((m: any) => m.orgId as string);

    // if none, create default org + membership
    if (!orgs.length) {
      const { data: newOrg, error: orgErr } = await supabase
        .from("Org")
        .insert({ name: "My Concrete Company" })
        .select("id")
        .single();
      if (orgErr) throw orgErr;
      const newOrgId = newOrg!.id as string;

      const { error: memInsErr } = await supabase
        .from("Membership")
        .insert({ orgId: newOrgId, userId: uid, role: "OWNER" });
      if (memInsErr) throw memInsErr;

      orgs = [newOrgId];
    }

    setOrgIds(orgs);

    // load projects across all orgs for this user
    const { data: projs, error: pErr } = await supabase
      .from("Project")
      .select('id, name, "orgId"')
      .in('"orgId"', orgs);
    if (pErr) throw pErr;

    setProjects((projs || []) as Project[]);
  }

  /** Create a snapshot for latest estimate on a project and open printable bid */
  async function createSnapshot(project: Project) {
    try {
      setBusyProjectId(project.id);
      setMsg(null);

      // latest estimate
      const { data: est, error: eErr } = await supabase
        .from("Estimate")
        .select('id, title, overheadPct, mobilizationCount, createdAt')
        .eq('"projectId"', project.id)
        .order("createdAt", { ascending: false })
        .limit(1)
        .single();
      if (eErr) throw eErr;

      // items
      const { data: items, error: iErr } = await supabase
        .from("EstimateItem")
        .select(
          'id, description, unit, quantity, unitCost, markupPct, contingencyPct, isMaterial, isLabor, isEquipment'
        )
        .eq('"estimateId"', est.id);
      if (iErr) throw iErr;

      // org-level settings/tax/tiers for THIS project org
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

      // normalize items
      const normItems = (items || []).map((it: any) => {
        const qty = Number(it.quantity || 0);
        const unitCost = Number(it.unitCost || 0);
        const lineTotal = qty * unitCost;
        return {
          id: it.id,
          desc: it.description,
          unit: it.unit,
          qty,
          unitCost,
          isMaterial: !!it.isMaterial,
          isLabor: !!it.isLabor,
          isEquipment: !!it.isEquipment,
          lineTotal,
        };
      });

      const subTotal = normItems.reduce((s, i) => s + i.lineTotal, 0);

      // markup via tiers (or fallback)
      let markupPct = 0;
      if (S?.useMarkupTiers && MK?.length) {
        const amt = subTotal;
        let matched = false;
        for (const t of MK) {
          const min = Number(t.minAmount || 0);
          const max = t.maxAmount === null ? Infinity : Number(t.maxAmount);
          if (amt >= min && amt < max) {
            markupPct = Number(t.percent || 0);
            matched = true;
            break;
          }
        }
        if (!matched && MK.length > 0) markupPct = Number(MK[MK.length - 1].percent || 0);
      } else {
        const mpctAvg =
          (items || []).reduce((s: number, it: any) => s + Number(it.markupPct || 0), 0) /
          Math.max(1, (items || []).length);
        markupPct = isFinite(mpctAvg) ? mpctAvg : 0;
      }
      const markupValue = (subTotal * markupPct) / 100;

      // contingency (after markup per your preference)
      const contingencyPct = Number(S?.defaultContingency || 0);
      const basePlusMarkup = subTotal + markupValue;
      const contingencyValue = (basePlusMarkup * contingencyPct) / 100;

      // tax by buckets
      const taxableBase =
        (T?.taxMaterials ? normItems.filter(i => i.isMaterial).reduce((s, i) => s + i.lineTotal, 0) : 0) +
        (T?.taxLabor ? normItems.filter(i => i.isLabor).reduce((s, i) => s + i.lineTotal, 0) : 0) +
        (T?.taxEquipment ? normItems.filter(i => i.isEquipment).reduce((s, i) => s + i.lineTotal, 0) : 0) +
        (T?.taxMarkup ? markupValue : 0) +
        (T?.taxContingency ? contingencyValue : 0);
      const taxRate = Number(T?.rate || 0);
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

      // save snapshot
      const { data: snap, error: sErr } = await supabase
        .from("EstimateSnapshot")
        .insert({ estimateId: est.id, version: 1, data: snapshotData })
        .select("id")
        .single();
      if (sErr) throw sErr;

      // open printable bid
      window.location.href = `/b/${snap.id}`;
    } catch (err: any) {
      console.error("Create snapshot failed:", err);
      alert(`Create snapshot failed: ${err?.message || String(err)}`);
    } finally {
      setBusyProjectId(null);
    }
  }

  /** -------- Render -------- */
  if (loading) return <div className="container">Loading…</div>;

  if (!userId) {
    return (
      <div className="container" style={{ maxWidth: 420 }}>
        <h1 className="title">Sign in to Concrete Estimator</h1>
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
          <button className="button" onClick={sendMagicLink}>Send Magic Link</button>
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

      {projects.length === 0 && (
        <div className="card">
          <p>No projects yet.</p>
          <p>Go to <a href="/settings">Settings</a> and click “Initialize Demo Data”, or ask your team to create one.</p>
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
              <button className="button" disabled={busyProjectId === p.id} onClick={() => createSnapshot(p)}>
                {busyProjectId === p.id ? "Working…" : "Create Snapshot"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
