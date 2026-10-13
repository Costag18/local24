"use client";

import { useEffect, useMemo, useState } from "react";
import { shortTime } from "@/lib/format";
import { useRotation } from "./hooks";
import type { Camera } from "@/lib/types";

interface Props {
  cams: Camera[];
  refreshMs: number;
  dwellMs: number;
  onClose: () => void;
}

type GridSize = 1 | 4 | 9;

/**
 * Full-screen camera wall, opened by the ⛶ on the band. Grid size is a
 * per-viewer preference; a single tile also unlocks the scrub-back slider,
 * which only makes sense when one camera fills the screen.
 */
export function CameraTakeover({ cams, refreshMs, dwellMs, onClose }: Props) {
  const live = useMemo(() => cams.filter((c) => !c.dead), [cams]);
  const [size, setSize] = useState<GridSize>(4);
  const [tick, setTick] = useState(() => Date.now());
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [scrubAt, setScrubAt] = useState<number | null>(null);
  const [frameTimes, setFrameTimes] = useState<number[]>([]);

  const pages = Math.max(1, Math.ceil(live.length / size));
  const [page] = useRotation(pages, dwellMs, scrubAt !== null);

  useEffect(() => {
    if (refreshMs <= 0 || scrubAt !== null) return;
    const t = setInterval(() => setTick(Date.now()), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs, scrubAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "1") setSize(1);
      if (e.key === "4") setSize(4);
      if (e.key === "9") setSize(9);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = live.slice(page * size, page * size + size);
  const solo = size === 1 ? shown[0] : null;

  // Scrub-back only exists for the buffered (proxied) camera in solo view.
  useEffect(() => {
    if (!solo) {
      setFrameTimes([]);
      setScrubAt(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/cam/${encodeURIComponent(solo.id)}?times=1`)
      .then((r) => r.json())
      .then((d: { times?: number[] }) => {
        if (!cancelled) setFrameTimes(d.times ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [solo, tick]);

  const cols = size === 1 ? 1 : size === 4 ? 2 : 3;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#000" }}>
      <div className="slab" style={{ background: "var(--panel)" }}>
        <span className="label label-accent">Camera Wall</span>
        <span className="label">{live.length} live</span>
        <span className="flex-1" />
        {([1, 4, 9] as GridSize[]).map((s) => (
          <button
            key={s}
            onClick={() => setSize(s)}
            className="label px-2 py-1 border"
            style={{
              borderColor: "var(--line)",
              background: size === s ? "var(--accent)" : "transparent",
              color: size === s ? "var(--accent-ink)" : "var(--ink-dim)",
            }}
          >
            {s === 1 ? "1×1" : s === 4 ? "2×2" : "3×3"}
          </button>
        ))}
        <button onClick={onClose} className="label px-2 py-1 border" style={{ borderColor: "var(--line)" }}>
          ⛶ CLOSE (ESC)
        </button>
      </div>

      <div
        className="flex-1 grid gap-px"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, background: "var(--line)", minHeight: 0 }}
      >
        {shown.map((cam) => {
          const src =
            solo && scrubAt !== null
              ? `/api/cam/${encodeURIComponent(cam.id)}?at=${scrubAt}`
              : solo
                ? `/api/cam/${encodeURIComponent(cam.id)}?t=${tick}`
                : `${cam.imageUrl}${cam.imageUrl.includes("?") ? "&" : "?"}t=${tick}`;
          return (
            <div key={cam.id} className="relative" style={{ background: "#000", minHeight: 0 }}>
              {!failed[cam.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={cam.label}
                  onError={() => setFailed((f) => ({ ...f, [cam.id]: true }))}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center label" style={{ color: "var(--dead)" }}>
                  Signal lost
                </div>
              )}
              <span
                className="absolute left-0 bottom-0 right-0 label truncate px-2 py-1"
                style={{ background: "rgba(0,0,0,0.72)", color: "#fff" }}
              >
                {cam.label}
              </span>
            </div>
          );
        })}
      </div>

      {solo && frameTimes.length > 1 && (
        <div className="flex items-center gap-3 px-4 py-2" style={{ background: "var(--panel)" }}>
          <span className="label label-accent">Rewind</span>
          <input
            type="range"
            min={0}
            max={frameTimes.length - 1}
            defaultValue={0}
            onChange={(e) => {
              const i = Number(e.target.value);
              // The list is newest-first, so index 0 is live.
              setScrubAt(i === 0 ? null : frameTimes[i]);
            }}
            style={{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span className="label num" style={{ minWidth: "10ch", textAlign: "right" }}>
            {scrubAt === null ? "LIVE" : shortTime(scrubAt)}
          </span>
          {scrubAt !== null && (
            <button
              onClick={() => setScrubAt(null)}
              className="label px-2 py-1"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              GO LIVE
            </button>
          )}
        </div>
      )}
    </div>
  );
}
