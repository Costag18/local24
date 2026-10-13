"use client";

import { useEffect, useMemo, useState } from "react";
import { ago, shortTime } from "@/lib/format";
import { radarFrameUrl, radarGrid } from "@/lib/radar";

interface RadarInfo {
  frames: string[];
  layers: string[];
  home: { label: string; lat: number; lon: number };
}

/** Each frame is six minutes of weather; this plays them at a readable clip. */
const STEP_MS = 450;
/** The newest frame holds a little longer so "now" registers. */
const HOLD_STEPS = 5;

/**
 * Environment Canada radar over the last ninety minutes, looping.
 *
 * Every frame is drawn up front and only the current one is visible, so the
 * loop never waits on a download or flashes an empty map between frames.
 */
export function RadarPanel({ now }: { now: number }) {
  const [info, setInfo] = useState<RadarInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void fetch("/api/radar", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: RadarInfo) => {
          if (cancelled) return;
          setInfo(d);
          setFailed(!d.frames.length);
        })
        .catch(() => !cancelled && setFailed(true));
    load();
    const t = setInterval(load, 3 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), STEP_MS);
    return () => clearInterval(t);
  }, []);

  const grid = useMemo(() => (info ? radarGrid(info.home.lat, info.home.lon) : null), [info]);
  const frames = info?.frames ?? [];
  const cycle = frames.length + HOLD_STEPS;
  const index = frames.length ? Math.min(tick % cycle, frames.length - 1) : 0;
  const shown = frames[index];
  const latest = index === frames.length - 1;

  if (!grid || !info) {
    return (
      <div className="h-full grid place-items-center label" style={{ color: "var(--ink-faint)" }}>
        {failed ? "Radar unavailable" : "Loading radar…"}
      </div>
    );
  }

  const [hx, hy] = grid.px(info.home.lat, info.home.lon);
  const tiles: { x: number; y: number }[] = [];
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) tiles.push({ x: c, y: r });

  return (
    <div className="relative h-full" style={{ background: "#0b0d10", minHeight: 0, overflow: "hidden" }}>
      <svg
        viewBox={`0 0 ${grid.width} ${grid.height}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {tiles.map((t) => (
          <image
            key={`${t.x}-${t.y}`}
            href={`/api/radar/tile/${grid.z}/${grid.x0 + t.x}/${grid.y0 + t.y}`}
            x={t.x * 256}
            y={t.y * 256}
            width={256}
            height={256}
          />
        ))}
        {frames.map((time, i) =>
          info.layers.map((layer) => (
            <image
              key={`${layer}-${time}`}
              href={radarFrameUrl(layer, time, grid)}
              x={0}
              y={0}
              width={grid.width}
              height={grid.height}
              opacity={i === index ? 0.8 : 0}
            />
          )),
        )}
        {/* Place names above the rain, so a storm never hides where it is. */}
        {tiles.map((t) => (
          <image
            key={`ref-${t.x}-${t.y}`}
            href={`/api/radar/tile/${grid.z}/${grid.x0 + t.x}/${grid.y0 + t.y}?layer=ref`}
            x={t.x * 256}
            y={t.y * 256}
            width={256}
            height={256}
          />
        ))}
        <circle cx={hx} cy={hy} r={9} fill="none" stroke="#fff" strokeWidth={2} opacity={0.85} />
        <circle cx={hx} cy={hy} r={2.5} fill="#fff" />
      </svg>

      <div className="absolute left-0 right-0 top-0 flex items-center gap-2 px-3 py-1.5"
           style={{ background: "linear-gradient(rgba(0,0,0,0.75), transparent)" }}>
        <span className="label num" style={{ color: latest ? "var(--accent)" : "#fff" }}>
          {shown ? shortTime(Date.parse(shown)) : "--"}
        </span>
        <span className="label" style={{ color: "rgba(255,255,255,0.6)" }}>
          {latest ? "LATEST" : shown ? ago(Date.parse(shown), now) : ""}
        </span>
        <span className="flex-1" />
        {/* What the colours mean: the picture alone does not say. */}
        <span className="label" style={{ color: "rgba(255,255,255,0.75)" }}>
          Rain &amp; snow · last 90 min
        </span>
        <span style={{ display: "inline-flex", height: 6, width: 54, borderRadius: 2, overflow: "hidden" }}
              title="Light to heavy precipitation">
          {["#99ccff", "#3399ff", "#00cc00", "#ffff00", "#ff9900", "#ff0000"].map((c) => (
            <span key={c} style={{ flex: 1, background: c }} />
          ))}
        </span>
        {/* Where the loop is, as a thin track. */}
        <span style={{ width: 70, height: 3, background: "rgba(255,255,255,0.15)", borderRadius: 2 }}>
          <span
            style={{
              display: "block", height: "100%", borderRadius: 2, background: "var(--accent)",
              width: `${frames.length ? ((index + 1) / frames.length) * 100 : 0}%`,
            }}
          />
        </span>
      </div>

      <div className="absolute right-0 bottom-0 px-2 py-0.5" style={{ fontSize: 9, color: "rgba(255,255,255,0.45)" }}>
        Radar: Environment Canada · Basemap: Esri
      </div>
    </div>
  );
}
