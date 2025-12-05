"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

type ProjectRow = {
  id: string;
  name: string;
  orgId: string;
  createdAt: string;
};

export default function Home() {
  // Toggle this open to see what the app thinks your session is
  const [showDebug, setShowDebug] = useState(true);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);

  async function fetchProjects() {
    setLoading(true);
    setErrMsg(null);
    setProjects(null);

    // read session
    const { data: me, error: meErr } = await supabase.auth.getUser();
    if (meErr) {
      setErrMsg(meErr.message);
      setLoading(false);
      return;
    }
    const uid = me.user?.id ?? null;
    const email = me.user?.email ?? null;
    setUserId(uid);
    setSessionEmail(email);

    if (!uid) {
      setErrMsg("Auth session missing!");
      setLoading(false);
      return;
    }

    // RPC that uses auth.uid() internally
    const { data, error } = await supabase.rpc("list_my_projects");
    if (error) {
      setErrMsg(error.message);
    } else {
      setProjects(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchProjects();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      fetchProjects();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px" }}>
      {/* Build marker so we know this version is live */}
      <p style={{ marginTop: 8, color: "#666" }}>
        Build marker: <b>HOME-V6-SINGLE-NAV</b>
      </p>

      <details
        open={showDebug}
        style={{ marginTop: 12 }}
        onToggle={(e) => setShowDebug((e.target as HTMLDetailsElement).open)}
      >
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Debug</summary>
        <div style={{ fontFamily: "monospace", marginTop: 8 }}>
          <div>
            <b>userId:</b> {userId ?? "(not signed in)"}
          </div>
          <div>
            <b>email:</b> {sessionEmail ?? "-"}
          </div>
          <div>
            <b>projects count:</b> {projects?.length ?? 0}
          </div>
          {errMsg && (
            <div style={{ color: "crimson" }}>
              <b>error:</b> {errMsg}
            </div>
          )}
        </div>
        <pre
          style={{
            background: "#f6f8fa",
            padding: 12,
            borderRadius: 6,
            overflow: "auto",
          }}
        >
          {JSON.stringify(projects, null, 2)}
        </pre>
        <button
          disabled={loading}
          onClick={() => fetchProjects()}
          style={{ marginTop: 8, padding: "6px 12px" }}
        >
          {loading ? "Loading…" : "Reload"}
        </button>
      </details>

      <h1 style={{ marginTop: 24 }}>Welcome, {sessionEmail ?? "friend"}</h1>

      {/* main content */}
      {errMsg ? (
        <p style={{ color: "crimson" }}>
          Couldn’t load projects: {errMsg}{" "}
          <button onClick={() => fetchProjects()}>Retry</button>
        </p>
      ) : projects === null ? (
        <p>Loading…</p>
      ) : projects.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              borderRadius: 8,
              padding: 16,
            }}
          >
            <p>
              <b>Next steps:</b>
            </p>
            <ol>
              <li>
                Open <Link href="/settings">Settings</Link> and click{" "}
                <b>Initialize Demo Data</b>.
              </li>
              <li>
                Return here to see your sample project and make a printable bid.
              </li>
            </ol>
          </div>
          <p style={{ marginTop: 16 }}>
            No projects yet. Go to <Link href="/settings">Settings</Link> and
            click <b>Initialize Demo Data</b>.
          </p>
        </div>
      ) : (
        <>
          <h2 style={{ marginTop: 24 }}>Your Projects</h2>
          <ul style={{ marginTop: 8 }}>
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/b/${p.id}`}>{p.name}</Link>
                <span style={{ color: "#666" }}>
                  {" "}
                  — {new Date(p.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
