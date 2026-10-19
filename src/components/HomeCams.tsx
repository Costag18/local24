"use client";

import { useEffect, useState } from "react";
import { useBox } from "./hooks";
import { bestGrid } from "@/lib/shape";
import type { HomeCam } from "@/lib/types";

interface Props {
  cams: HomeCam[];
  /** Stills stop refreshing when the tab is hidden or data-saver is on. */
  suspend: boolean;
}

/**
 * The cameras on your own network.
 *
 * Arranged by the window's shape: side by side when it is wide, stacked when
 * it is tall, a grid when there are enough of them — whichever shows each
 * picture largest.
 *
 * Every request goes through the local proxy rather than straight at the
 * camera: that keeps credentials out of the browser and avoids the
 * mixed-content and CORS problems a plain-HTTP camera would otherwise cause.
 */
export function HomeCams({ cams, suspend }: Props) {
  const [tick, setTick] = useState(() => Date.now());
  // A Nest camera is a live stream that shows "Connecting…" until its first
  // frame arrives; a stream that drops reconnects itself (a new key).
  const [failed, setFailed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(cams.filter((c) => c.kind === "nest").map((c) => [c.id, true])),
  );
  const [streamKey, setStreamKey] = useState<Record<string, number>>({});
  const reconnect = (id: string) =>
    setTimeout(() => setStreamKey((k) => ({ ...k, [id]: (k[id] ?? 0) + 1 })), 2000);
  const [bodyRef, box] = useBox<HTMLDivElement>();
  const grid = bestGrid(cams.length, box.w, box.h);

  // One clock for every still, at the shortest interval any camera asks for.
  // Everything that is not a continuous stream is a still — a Nest camera is
  // served as a frame-at-a-time by the bridge, and when this only matched
  // `snapshot` the clock never started and the picture never changed.
  const shortest = cams
    .filter((c) => c.kind !== "mjpeg" && c.kind !== "nest")
    .reduce((min, c) => Math.min(min, Math.max(500, c.refreshMs || 5000)), 60_000);

  useEffect(() => {
    if (suspend || !cams.length || shortest >= 60_000) return;
    const t = setInterval(() => setTick(Date.now()), shortest);
    return () => clearInterval(t);
  }, [suspend, shortest, cams.length]);

  return (
    <section className="panel flex flex-col" style={{ minHeight: 0 }}>
      <div className="slab slab-quiet">
        <span className="label label-accent shrink-0 slab-name">Home</span>
        <span className="flex-1" />
        {cams.length > 0 && <span className="live-dot" />}
      </div>

      <div ref={bodyRef} className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
      {cams.length === 0 ? (
        <div className="flex-1 grid place-items-center px-2 py-4 text-center">
          <div>
            <div className="label">No cameras</div>
            <div className="label" style={{ color: "var(--ink-faint)", marginTop: 4, whiteSpace: "normal" }}>
              Add a camera in Settings
            </div>
          </div>
        </div>
      ) : (
        <div
          className="grid flex-1 gap-px"
          style={{
            minHeight: 0,
            background: "var(--line)",
            gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
          }}
        >
          {cams.map((cam) => (
            <div
              key={cam.id}
              className="relative"
              style={{ background: "#000", minHeight: 0, minWidth: 0 }}
              title={cam.label}
            >
              {/*
                The image stays mounted even while it is failing. Removing it
                meant the next tick had nothing to retry with, so one blip —
                a server restart, the bridge still warming up — left the pane
                reading "Offline" until the whole panel remounted.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                // An MJPEG stream must keep the same src or it restarts; a
                // still needs a changing one to defeat the cache.
                src={
                  cam.kind === "mjpeg"
                    ? `/api/homecam/${encodeURIComponent(cam.id)}`
                    : cam.kind === "nest" && !suspend
                      ? `/api/homecam/${encodeURIComponent(cam.id)}?stream=1&k=${streamKey[cam.id] ?? 0}`
                      : `/api/homecam/${encodeURIComponent(cam.id)}?t=${tick}`
                }
                alt={cam.label}
                onError={() => {
                  setFailed((f) => (f[cam.id] ? f : { ...f, [cam.id]: true }));
                  if (cam.kind === "nest") reconnect(cam.id);
                }}
                onLoad={() => setFailed((f) => (f[cam.id] ? { ...f, [cam.id]: false } : f))}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  visibility: failed[cam.id] ? "hidden" : "visible",
                }}
              />

              {failed[cam.id] && (
                <div
                  className="absolute inset-0 grid place-items-center label"
                  style={{ color: "var(--ink-faint)", whiteSpace: "normal", textAlign: "center", padding: 6 }}
                >
                  Connecting…
                </div>
              )}

              <span
                className="tag absolute left-0 right-0 bottom-0 px-1 py-0.5"
                style={{
                  background: "linear-gradient(transparent, rgba(0,0,0,0.86) 45%)",
                  color: "#fff",
                  fontSize: "8px",
                  letterSpacing: "0.01em",
                }}
              >
                {cam.label}
              </span>
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
