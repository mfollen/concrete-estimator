"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * DB row shape used on Home
 * NOTE: in your DB the column name is `createdat` (all lowercase).
 */
type ProjectRow = {
  id: string;
  name: string;
  orgId: string;
  createdat: string | null; // from Postgres
};

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErrMsg(null);
    try {
      // 1) Auth user
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = auth.user ?? null;
      setMeEmail(user?.email ?? null);

      if (!user) {
        setProjects([]);
        setLoading(false);
        return;
      }

      // 2) Org memberships for this user
      const { data: memberships, error: memErr } = await supabase
        .from("Membership")
        .select("orgId")
        .eq("userId", user.id);

      if (memErr) throw memErr;

      const orgIds = (memberships ?? []).map((m: any) => m.orgId).filter(Boolean);

      if (orgIds.length === 0) {
        setProjects([]);
        setLoading(false);
        return;
      }

      // 3) Projects within those orgs
      // IMPORTANT: your DB column is `createdat` (lowercase). Ordering on `createdAt` causes a 400.
      let proj: ProjectRow[] | null = null;

      const { data, error } = await supabase
        .from("Project")
        .select("id, name, orgId, createdat")
        .in("orgId", orgIds)
        .order("createdat", { ascending: false }) // correct column name
        .limit(50);

      if (error) {
        // As a safety net, retry without order then sort on the client
        const retry = await supabase
          .from("Project")
          .select("id, name, orgId, createdat")
          .in("orgId", orgIds)
          .limit(50);

        if (retry.error) throw retry.error;

        proj = (retry.data ?? []).sort((a: ProjectRow, b: ProjectRow) => {
          const aT = a.createdat ?? "";
          const bT = b.createdat ?? "";
          return aT === bT ? 0 : aT < bT ? 1 : -1; // descending
        });
      } else {
        proj = data ?? [];
      }

      setProjects(proj ?? []);
    } catch (e: any) {
      setErrMsg(e?.message || String(e));
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const buildMarker = "HOME-V3"; // shows which build you’re on

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <nav style={{ display: "flex", gap: 16 }}>
          <a href="/" style={{ textDecoration: "none" }}>Home</a>
          <a href="/settings" style={{ textDecoration: "none" }}>Settings</a>
        </nav>
        <strong>Concrete Estimator</strong>
      </header>

      <div style={{ marginBottom: 8, opacity: 0.6 }}>Build marker: {buildMarker}</div>

      {!meEmail ? (
        <>
          <h1>Sign in to Concrete Estimator</h1>
          <SignInForm />
        </>
      ) : (
        <>
          <h1>Welcome, {meEmail}</h1>

          {loading && <p>Loading your projects…</p>}

          {errMsg && (
            <p style={{ color: "crimson" }}>
              Couldn’t load projects: {errMsg}{" "}
              <button onClick={load} style={{ marginLeft: 8 }}>Retry</button>
            </p>
          )}

          {!loading && !errMsg && projects.length === 0 && (
            <div style={{ marginTop: 16 }}>
              <p>No projects yet.</p>
              <p>
                Go to <a href="/settings">Settings</a> and click <em>Initialize Demo Data</em>.
              </p>
            </div>
          )}

          {!loading && projects.length > 0 && (
            <section style={{ marginTop: 16 }}>
              <h2>Your Projects</h2>
              <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
                {projects.map((p) => (
                  <li
                    key={p.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>
                      Project ID: {p.id} · Org: {p.orgId}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

/** Simple email-only magic link sign-in form */
function SignInForm() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setMsg("Check your email for a magic link.");
    } catch (e: any) {
      setMsg(e?.message || String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, maxWidth: 420 }}>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Email</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #e5e7eb" }}
        />
      </div>
      <button onClick={send} disabled={sending} style={{ padding: "8px 12px" }}>
        {sending ? "Sending…" : "Send Magic Link"}
      </button>
      {msg && <p style={{ marginTop: 8 }}>{msg}</p>}
    </div>
  );
}
