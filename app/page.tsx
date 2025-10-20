"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type ProjectRow = {
  id: string;
  name: string;
  orgId: string;
  createdat: string | null;
};

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);          // DEBUG: show user id
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [debug, setDebug] = useState<any>(null);                   // DEBUG: dump RPC payload

  async function load() {
    setLoading(true);
    setErrMsg(null);
    setDebug(null);
    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const user = auth.user ?? null;
      setMeEmail(user?.email ?? null);
      setMeId(user?.id ?? null);

      if (!user) {
        setProjects([]);
        setLoading(false);
        return;
      }

      // RPC — no URL order params
      const { data, error } = await supabase.rpc("list_user_projects", {
        p_user_id: user.id,
      });

      if (error) throw error;

      // DEBUG: show raw response
      setDebug({ rpcCount: (data ?? []).length, rows: data });

      setProjects((data ?? []) as ProjectRow[]);
    } catch (e: any) {
      console.error("Home load error:", e);
      setErrMsg(e?.message || String(e));
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const buildMarker = "HOME-V4-RPC+DEBUG";

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

      {/* DEBUG PANEL */}
      <details style={{ marginBottom: 12 }}>
        <summary>Debug</summary>
        <div style={{ fontSize: 13, paddingTop: 8 }}>
          <div><b>userId:</b> {meId ?? "(not signed in)"}</div>
          <div><b>email:</b> {meEmail ?? "-"}</div>
          <div><b>projects count:</b> {projects.length}</div>
          {errMsg && <div style={{ color: "crimson" }}><b>error:</b> {errMsg}</div>}
          <pre style={{ background: "#f7f7f7", padding: 8, borderRadius: 6, overflow: "auto" }}>
            {JSON.stringify(debug, null, 2)}
          </pre>
          <button onClick={load} style={{ marginTop: 6 }}>Reload</button>
        </div>
      </details>

      {!meEmail ? (
        <>
          <h1>Sign in to Concrete Estimator</h1>
          <SignInForm />
        </>
      ) : (
        <>
          <h1>Welcome, {meEmail}</h1>

          {loading && <p>Loading your projects…</p>}

          {!loading && !errMsg && projects.length === 0 && (
            <div style={{ marginTop: 16 }}>
              <p>No projects yet.</p>
              <p>
                Go to <a href="/settings">Settings</a> and click <em>Initialize Demo Data</em>.
              </p>
            </div>
          )}

          {errMsg && (
            <p style={{ color: "crimson" }}>
              Couldn’t load projects: {errMsg}{" "}
              <button onClick={load} style={{ marginLeft: 8 }}>Retry</button>
            </p>
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
