"use client";

import { useEffect, useState } from "react";
import { ago, bytes } from "@/lib/format";
import type { AppState } from "@/lib/state";

/**
 * When a tile looks stale this page says why in one glance: which source last
 * succeeded, what it last failed with, and how much data it has pulled.
 */
export function HealthClient() {
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = Date.now();

  const load = () =>
    void fetch("/api/state?diag=1", { cache: "no-store" })
      .then((r) => r.json())
      .then(setState)
      .catch(() => undefined);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const run = async (job: string) => {
    setBusy(job);
    await fetch("/api/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job }),
    }).catch(() => undefined);
    load();
    setBusy(null);
  };

  if (!state) return <div className="p-6 label">Loading…</div>;

  const totalBytes = state.health.reduce((n, h) => n + h.bytes, 0);
  // Per-camera rows would drown the list; they are summarised instead.
  const camRows = state.health.filter((h) => h.sourceId.startsWith("cam."));
  const rows = state.health.filter((h) => !h.sourceId.startsWith("cam."));

  return (
    <div className="scroll-y" style={{ height: "100vh" }}>
      <header className="slab sticky top-0 z-10" style={{ background: "var(--panel)" }}>
        <span className="label label-accent">Source health</span>
        <span className="label">{bytes(totalBytes)} pulled this session</span>
        <span className="flex-1" />
        <button
          onClick={() => void run("all")}
          className="label px-2 py-1 border"
          style={{ borderColor: "var(--line)" }}
        >
          {busy === "all" ? "Refreshing…" : "Refresh all"}
        </button>
        <a href="/settings" className="label px-2 py-1 border" style={{ borderColor: "var(--line)" }}>Settings</a>
        <a href="/" className="label px-2 py-1" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
          ← Back
        </a>
      </header>

      <div className="p-4 flex flex-col gap-4" style={{ maxWidth: 1000, margin: "0 auto" }}>
        <section className="panel">
          <div className="slab"><span className="label label-accent">Jobs</span></div>
          {state.jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-3 px-3 py-2 border-b" style={{ borderColor: "var(--line)" }}>
              <span className="text-sm" style={{ minWidth: "16ch" }}>{j.label}</span>
              <span className="label" style={{ minWidth: "12ch" }}>
                {j.running ? "running…" : j.lastRun ? ago(j.lastRun, now) : "not yet run"}
              </span>
              <span className="label" style={{ color: "var(--ink-faint)", minWidth: "12ch" }}>
                next in {Math.round(j.nextInMs / 1000)}s
              </span>
              <span className="flex-1" />
              <button
                onClick={() => void run(j.id)}
                className="label px-2 py-1 border"
                style={{ borderColor: "var(--line)" }}
              >
                {busy === j.id ? "…" : "Run now"}
              </button>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="slab"><span className="label label-accent">Sources</span></div>
          {rows.map((h) => {
            const bad = h.consecutiveFailures > 0;
            return (
              <div key={h.sourceId} className="flex items-center gap-3 px-3 py-2 border-b" style={{ borderColor: "var(--line)" }}>
                <span
                  style={{
                    width: 6, height: 6, borderRadius: "50%", flex: "0 0 auto",
                    background: bad ? "var(--accent)" : "var(--ok)",
                  }}
                />
                <span className="text-sm num" style={{ minWidth: "20ch" }}>{h.sourceId}</span>
                <span className="label" style={{ minWidth: "10ch" }}>
                  {h.lastSuccess ? ago(h.lastSuccess, now) : "never"}
                </span>
                <span className="label num" style={{ minWidth: "8ch" }}>
                  {h.latencyMs !== null ? `${h.latencyMs}ms` : "—"}
                </span>
                <span className="label num" style={{ minWidth: "9ch" }}>{bytes(h.bytes)}</span>
                <span className="label truncate flex-1" style={{ color: bad ? "var(--accent)" : "var(--ink-faint)" }}>
                  {bad ? `${h.consecutiveFailures}× ${h.lastError ?? "failed"}` : "ok"}
                </span>
              </div>
            );
          })}
        </section>

        <section className="panel">
          <div className="slab">
            <span className="label label-accent">Cameras</span>
            <span className="label">{camRows.length} polled · {bytes(camRows.reduce((n, h) => n + h.bytes, 0))}</span>
          </div>
          <div className="p-3 label" style={{ color: "var(--ink-faint)" }}>
            Only the hero camera is proxied through the server (for frozen-feed detection and
            rewind); thumbnails load straight from the source.
          </div>
        </section>
      </div>
    </div>
  );
}
