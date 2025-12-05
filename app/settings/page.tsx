"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

// lightweight shapes
type Org = { id: string; name: string };

// Small helper so auth.getUser() can’t hang forever
async function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("Request timed out")), ms);
    p.then(
      (val) => {
        clearTimeout(id);
        resolve(val);
      },
      (err) => {
        clearTimeout(id);
        reject(err);
      }
    );
  });
}

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  // auth
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // org + settings
  const [org, setOrg] = useState<Org | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [tax, setTax] = useState<any | null>(null);
  const [tiers, setTiers] = useState<any[]>([]);

  // legacy demo (direct inserts)
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  // serverless demo
  const [apiBusy, setApiBusy] = useState(false);
  const [apiMsg, setApiMsg] = useState<string | null>(null);
  const [apiErr, setApiErr] = useState<string | null>(null);

  // ---- auth helpers ----
  async function signInWithEmail() {
    const email = window.prompt("Enter your email to get a magic link:");
    if (!email) return;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) alert(error.message);
    else alert("Magic link sent. Check your email and come back here after clicking it.");
  }

  async function signOutNow() {
    await supabase.auth.signOut();
    setUserId(null);
    setUserEmail(null);
    setOrg(null);
    setSettings(null);
    setTax(null);
    setTiers([]);
  }

  // ---- boot/load flow ----
  useEffect(() => {
    let mounted = true;

    // watch auth changes (magic-link return, sign-out, etc.)
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      const uid = session?.user?.id ?? null;
      const email = session?.user?.email ?? null;
      setUserId(uid);
      setUserEmail(email);
      if (uid) {
        await loadOrgAndConfig(uid);
      } else {
        setLoading(false);
      }
    });

    // initial check
    (async () => {
      try {
        setLoading(true);
        setErrorText(null);

        // timeout only here
        const { data, error } = await withTimeout(supabase.auth.getUser());
        if (error) throw error;

        const uid = data.user?.id ?? null;
        const email = data.user?.email ?? null;
        setUserId(uid);
        setUserEmail(email);

        if (uid) {
          await loadOrgAndConfig(uid);
        } else {
          setLoading(false);
        }
      } catch (e: any) {
        console.error(e);
        setErrorText(e?.message || "Unable to check auth status.");
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function loadOrgAndConfig(uid: string) {
    try {
      setLoading(true);
      setErrorText(null);

      // find an org via membership (or create one)
      let orgId: string | null = null;
      const { data: mems, error: memErr } = await supabase
        .from("Membership")
        .select('"orgId"')
        .eq('"userId"', uid);
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
          .insert({ orgId, userId: uid, role: "OWNER" });
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

      // Load config (no timeout wrapper here)
      const [
        { data: S, error: sErr },
        { data: T, error: tErr },
        { data: MK, error: mkErr },
      ] = await Promise.all([
        supabase.from("OrgSettings").select("*").eq('"orgId"', orgId!).single(),
        supabase.from("TaxScope").select("*").eq('"orgId"', orgId!).single(),
        supabase.from("MarkupTier").select("*").eq('"orgId"', orgId!),
      ]);

      if (sErr) throw sErr;
      if (tErr) throw tErr;
      if (mkErr) throw mkErr;

      setSettings(S);
      setTax(T);

      const sortedTiers = ((MK as any[]) ?? [])
        .slice()
        .sort((a, b) => (a?.rank ?? 0) - (b?.rank ?? 0));
      setTiers(sortedTiers);
    } catch (e: any) {
      console.error(e);
      setErrorText(e?.message || "Failed to load organization settings.");
    } finally {
      setLoading(false);
    }
  }

  async function seedDemoViaApi() {
    setApiBusy(true);
    setApiMsg(null);
    setApiErr(null);
    try {
      if (!userId) throw new Error("Please sign in first.");
      const res = await fetch("/api/seed-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to seed demo data");
      setApiMsg(
        `Demo ready — org:${json.summary.org}, project:${json.summary.project}, estimate:${json.summary.estimate}, items:${json.summary.items}`
      );
    } catch (e: any) {
      setApiErr(e?.message ?? "Unknown error while seeding");
    } finally {
      setApiBusy(false);
    }
  }

  // Legacy direct insert demo
  const initDemoProject = async (orgId: string) => {
    setDemoStatus(null);
    setDemoBusy(true);
    try {
      const { data: me, error: meErr } = await supabase.auth.getUser();
      if (meErr) throw meErr;
      const uid = me.user?.id;
      if (!uid) throw new Error("No signed-in user.");

      setDemoStatus("Creating project…");
      const { data: project, error: pErr } = await supabase
        .from("Project")
        .insert({
          orgId,
          name: "Warehouse Expansion",
          clientName: "BigCo",
          location: "Joliet, IL",
          createdBy: uid,
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
          createdBy: uid,
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
          rank: 1,
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
          rank: 2,
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
          rank: 3,
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

  async function save() {
    try {
      if (!org || !settings || !tax) return;
      await supabase.from("OrgSettings").upsert(settings, { onConflict: "orgId" });
      await supabase
        .from("TaxScope")
        .upsert({ orgId: org.id, ...tax }, { onConflict: "orgId" });

      await supabase.from("MarkupTier").delete().eq('"orgId"', org.id);
      const toInsert = tiers.map((t: any) => ({ ...t, id: undefined, orgId: org.id }));
      if (toInsert.length) await supabase.from("MarkupTier").insert(toInsert);
      alert("Saved!");
    } catch (e: any) {
      alert(e?.message || "Save failed");
    }
  }

  // ---------- render ----------
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px" }}>
      <p style={{ marginTop: 8, color: "#666" }}>
        Build marker: <b>SETTINGS-V3-NOTIMEOUT</b>
      </p>

      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h1 className="title">Settings</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="text-sm">
            {userId ? `Signed in${userEmail ? `: ${userEmail}` : ""}` : "Not signed in"}
          </span>
          {!userId ? (
            <button className="button secondary" onClick={signInWithEmail}>
              Sign in
            </button>
          ) : (
            <button className="button secondary" onClick={signOutNow}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {errorText && (
        <div className="card" style={{ color: "crimson", marginBottom: 16 }}>
          {errorText}
        </div>
      )}

      {loading && <div className="card">Loading…</div>}

      {!loading && !userId && (
        <div className="card">
          <p>Sign in with a magic link to manage your org and seed demo data.</p>
          <button className="button" onClick={signInWithEmail}>
            Send magic link
          </button>
        </div>
      )}

      {!loading && userId && (
        <>
          {/* Serverless seeder */}
          <div className="card" style={{ marginBottom: 16 }}>
            <p>
              <strong>Seed via API:</strong> Creates/reuses Demo Org, Warehouse Expansion
              project, one estimate, and sample items (idempotent).
            </p>
            <button className="button" disabled={apiBusy} onClick={seedDemoViaApi}>
              {apiBusy ? "Seeding…" : "Seed Demo (serverless)"}
            </button>
            {apiMsg && <p style={{ marginTop: 8, color: "green" }}>{apiMsg}</p>}
            {apiErr && <p style={{ marginTop: 8, color: "crimson" }}>{apiErr}</p>}
          </div>

          {/* Legacy direct insert */}
          <div className="card" style={{ marginBottom: 16 }}>
            <p>
              <strong>Legacy step:</strong> Directly create a demo project (may create
              duplicates).
            </p>
            <button
              className="button"
              disabled={demoBusy || !org}
              onClick={() => org && initDemoProject(org.id)}
            >
              {demoBusy ? "Working…" : "Initialize Demo Data (direct)"}
            </button>
            {demoStatus && <p style={{ marginTop: 8 }}>{demoStatus}</p>}
          </div>

          {/* Only show config if org + settings loaded */}
          {!org || !settings || !tax ? (
            <div className="card">Loading organization config…</div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <h2 className="text-lg">Branding</h2>
                <div className="field">
                  <label>Logo URL</label>
                  <input
                    value={settings.logoUrl ?? ""}
                    onChange={(e) =>
                      setSettings({ ...settings, logoUrl: e.target.value })
                    }
                    placeholder="/logo.svg"
                  />
                </div>
                <div className="field">
                  <label>License / Bonding</label>
                  <textarea
                    value={settings.licenseText ?? ""}
                    onChange={(e) =>
                      setSettings({ ...settings, licenseText: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Terms</label>
                  <textarea
                    value={settings.termsText ?? ""}
                    onChange={(e) =>
                      setSettings({ ...settings, termsText: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Exclusions</label>
                  <textarea
                    value={settings.exclusionsText ?? ""}
                    onChange={(e) =>
                      setSettings({ ...settings, exclusionsText: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Quote Validity (days)</label>
                  <input
                    type="number"
                    value={settings.validityDays ?? 30}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        validityDays: parseInt(e.target.value || "30", 10),
                      })
                    }
                  />
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <h2 className="text-lg">Cost behavior</h2>
                <div className="field">
                  <label>Use markup tiers</label>
                  <select
                    value={settings.useMarkupTiers ? "true" : "false"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        useMarkupTiers: e.target.value === "true",
                      })
                    }
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div className="field">
                  <label>Contingency (%)</label>
                  <input
                    type="number"
                    value={settings.defaultContingency ?? 5}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        defaultContingency: parseFloat(e.target.value || "0"),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Contingency order</label>
                  <select
                    value={settings.contingencyOrder}
                    onChange={(e) =>
                      setSettings({ ...settings, contingencyOrder: e.target.value })
                    }
                  >
                    <option value="AFTER_MARKUP">After markup</option>
                    <option value="BEFORE_MARKUP">Before markup</option>
                  </select>
                </div>
                <div className="field">
                  <label>Mobilization price ($)</label>
                  <input
                    type="number"
                    value={settings.mobilizationPrice ?? 3850}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        mobilizationPrice: parseFloat(e.target.value || "0"),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Crew hours per day</label>
                  <input
                    type="number"
                    value={settings.crewHoursPerDay ?? 8}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        crewHoursPerDay: parseInt(e.target.value || "8", 10),
                      })
                    }
                  />
                </div>
              </div>

              <div className="card">
                <h2 className="text-lg">Tax</h2>
                <div className="field">
                  <label>Tax rate (%)</label>
                  <input
                    type="number"
                    value={tax.rate ?? 0}
                    onChange={(e) =>
                      setTax({ ...tax, rate: parseFloat(e.target.value || "0") })
                    }
                  />
                </div>
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!tax.taxMaterials}
                      onChange={(e) =>
                        setTax({ ...tax, taxMaterials: e.target.checked })
                      }
                    />{" "}
                    Materials
                  </label>
                </div>
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!tax.taxLabor}
                      onChange={(e) =>
                        setTax({ ...tax, taxLabor: e.target.checked })
                      }
                    />{" "}
                    Labor
                  </label>
                </div>
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!tax.taxEquipment}
                      onChange={(e) =>
                        setTax({ ...tax, taxEquipment: e.target.checked })
                      }
                    />{" "}
                    Equipment
                  </label>
                </div>
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!tax.taxMarkup}
                      onChange={(e) =>
                        setTax({ ...tax, taxMarkup: e.target.checked })
                      }
                    />{" "}
                    Markup
                  </label>
                </div>
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!tax.taxContingency}
                      onChange={(e) =>
                        setTax({ ...tax, taxContingency: e.target.checked })
                      }
                    />{" "}
                    Contingency
                  </label>
                </div>
              </div>

              <div className="card" style={{ marginTop: 16 }}>
                <h2 className="text-lg">Markup tiers</h2>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Min ($)</th>
                      <th>Max ($)</th>
                      <th>Percent (%)</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.map((t, i) => (
                      <tr key={i}>
                        <td>
                          <input
                            type="number"
                            value={t.rank}
                            onChange={(e) =>
                              updateTier(i, {
                                ...t,
                                rank: parseInt(e.target.value || "0", 10),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={t.minAmount}
                            onChange={(e) =>
                              updateTier(i, {
                                ...t,
                                minAmount: parseFloat(e.target.value || "0"),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={t.maxAmount ?? ""}
                            onChange={(e) =>
                              updateTier(i, {
                                ...t,
                                maxAmount:
                                  e.target.value === ""
                                    ? null
                                    : parseFloat(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={t.percent}
                            onChange={(e) =>
                              updateTier(i, {
                                ...t,
                                percent: parseFloat(e.target.value || "0"),
                              })
                            }
                          />
                        </td>
                        <td>
                          <button
                            className="button secondary"
                            onClick={() => removeTier(i)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 8 }}>
                  <button className="button secondary" onClick={addTier}>
                    Add tier
                  </button>{" "}
                  <button className="button" onClick={save}>
                    Save all
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );

  // ------- local helpers for tiers -------
  function addTier() {
    setTiers((prev) => [
      ...prev,
      {
        rank: (prev.at(-1)?.rank ?? 0) + 1,
        minAmount: 0,
        maxAmount: null,
        percent: 10,
      },
    ]);
  }

  function removeTier(i: number) {
    setTiers((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateTier(i: number, t: any) {
    setTiers((prev) => {
      const next = [...prev];
      next[i] = t;
      return next;
    });
  }
}

// --------- defaults seeding ----------
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
}
