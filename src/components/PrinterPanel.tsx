"use client";

import { useEffect, useState } from "react";
import { duration } from "@/lib/format";
import type { PrinterView, Tray } from "@/lib/printer";
// (type-only: the module itself is server code and never reaches the browser)

/** Why there is no picture, in words someone can act on. */
const CAMERA_NOTE: Record<string, string> = {
  "liveview-off": "Camera: turn on LAN Only Liveview on the printer (Settings → Network)",
  "needs-ffmpeg": "Camera needs ffmpeg to play this printer's video",
  error: "Camera reconnecting…",
  connecting: "Connecting to camera…",
  off: "Connecting to camera…",
};

const STATE_LABEL: Record<string, string> = {
  RUNNING: "Printing",
  PREPARE: "Preparing",
  PAUSE: "Paused",
  FINISH: "Finished",
  FAILED: "Failed",
  IDLE: "Idle",
};

/**
 * The 3D printer: its camera, with progress laid over the bottom.
 *
 * Both are polled only while this page is showing. The server keeps its
 * connections to the printer open just as long as these requests keep coming,
 * so rotating away from the page also lets the printer go.
 */
export function PrinterPanel({ label }: { label: string }) {
  const [view, setView] = useState<PrinterView | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [camState, setCamState] = useState<string>("connecting");

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      void fetch("/api/printer", { cache: "no-store" })
        .then((r) => r.json())
        .then((v: PrinterView) => {
          if (!cancelled) setView(v);
        })
        .catch(() => undefined);
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Frames are fetched as blobs so a 204 ("no picture yet") never shows a
  // broken-image icon, and the previous frame stays up until the next lands.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    const pull = async () => {
      try {
        const r = await fetch("/api/printer/frame", { cache: "no-store" });
        if (cancelled) return;
        setCamState(r.headers.get("x-camera-state") ?? "error");
        if (r.status !== 200) return;
        const next = URL.createObjectURL(await r.blob());
        if (cancelled) return URL.revokeObjectURL(next);
        if (url) URL.revokeObjectURL(url);
        url = next;
        setFrame(next);
      } catch {
        /* the next tick retries */
      }
    };
    void pull();
    const t = setInterval(() => void pull(), 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const s = view?.status ?? null;
  const pct = s?.percent ?? null;
  const active = s && (s.state === "RUNNING" || s.state === "PAUSE" || s.state === "PREPARE");

  return (
    <div className="relative h-full" style={{ background: "#000", minHeight: 0 }}>
      {frame && camState === "streaming" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frame}
          alt={label}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <div
          className="absolute inset-0 grid place-items-center label px-4 text-center"
          style={{ color: "var(--ink-faint)", whiteSpace: "normal" }}
        >
          {view && !view.configured
            ? "Add the printer in Settings"
            : (CAMERA_NOTE[camState] ?? "Connecting to camera…")}
        </div>
      )}

      {s && (
        <div
          className="absolute left-0 right-0 bottom-0 px-3 pt-6 pb-2"
          style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.88) 40%)" }}
        >
          <div className="flex items-baseline gap-2">
            <span className="label" style={{ color: s.errorCode ? "var(--accent)" : "var(--ok)" }}>
              {STATE_LABEL[s.state] ?? s.state}
            </span>
            {active && pct !== null && (
              <span className="figure font-bold" style={{ color: "#fff", fontSize: "1.25em" }}>{pct}%</span>
            )}
            <span className="text-xs wrap2 flex-1" style={{ color: "rgba(255,255,255,0.75)", minWidth: 0 }}>{s.file}</span>
            {active && (
              <span className="label num" style={{ color: "#fff" }}>{duration(s.remainingMin)} left</span>
            )}
          </div>
          {active && pct !== null && (
            <div style={{ height: 3, background: "rgba(255,255,255,0.15)", marginTop: 4, borderRadius: 2 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 label num" style={{ color: "rgba(255,255,255,0.6)" }}>
            {s.layer !== null && s.totalLayers ? <span>Layer {s.layer}/{s.totalLayers}</span> : null}
            <span>Nozzle {s.nozzle !== null ? Math.round(s.nozzle) : "--"}°</span>
            <span>Bed {s.bed !== null ? Math.round(s.bed) : "--"}°</span>
          </div>
          {s.trays.length > 0 && <Trays trays={s.trays} />}
        </div>
      )}
    </div>
  );
}

/**
 * What is loaded, slot by slot: a swatch in the filament's colour, its type,
 * and how much is left when the spool's chip says. The slot printing now is
 * outlined.
 */
function Trays({ trays }: { trays: Tray[] }) {
  return (
    <div className="flex gap-1.5 mt-1.5">
      {trays.map((t) => (
        <div
          key={t.slot}
          className="flex items-center gap-1.5 px-1.5 py-0.5"
          title={`${t.slot}: ${t.name || t.type || "empty"}${t.remain !== null ? ` · ${t.remain}% left` : ""}`}
          style={{
            flex: "1 1 0",
            minWidth: 0,
            borderRadius: 2,
            background: "rgba(255,255,255,0.06)",
            outline: t.active ? "1px solid var(--accent)" : "1px solid transparent",
          }}
        >
          <span
            style={{
              width: 10, height: 10, borderRadius: 2, flex: "0 0 auto",
              background: t.type ? t.color : "transparent",
              border: "1px solid rgba(255,255,255,0.35)",
            }}
          />
          <span className="label truncate" style={{ color: t.active ? "#fff" : "rgba(255,255,255,0.7)" }}>
            {t.type || "—"}
          </span>
          {t.remain !== null && (
            <span className="label num" style={{ color: t.remain < 15 ? "var(--warn)" : "rgba(255,255,255,0.5)" }}>
              {t.remain}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
