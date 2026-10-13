"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inTimeWindow } from "@/lib/format";
import type { TrafficEvent, Weather } from "@/lib/types";

interface Props {
  closures: TrafficEvent[];
  weather: Weather | null;
  chimeEnabled: boolean;
  dndFrom: string | null;
  dndTo: string | null;
  onDismiss: () => void;
  dismissed: boolean;
}

/**
 * Weather warnings outrank road closures. A chime fires once per distinct
 * alert, and never inside the do-not-disturb window.
 */
export function BreakingBanner({
  closures, weather, chimeEnabled, dndFrom, dndTo, onDismiss, dismissed,
}: Props) {
  /**
   * Everything worth announcing, weather warnings first. The banner is one
   * line, so several closures take turns rather than one of them winning and
   * the rest never being seen.
   */
  const alerts = useMemo(() => {
    const warnings = (weather?.warnings ?? []).map((w) => ({
      kind: "ALERT",
      text: w.title,
      id: `w:${w.title}`,
    }));
    const roads = closures.slice(0, 5).map((c) => ({
      kind: "ROAD CLOSED",
      text: `${c.roadway} ${c.direction} — ${c.description}`.replace(/\s+/g, " ").trim(),
      id: `c:${c.id}`,
    }));
    return [...warnings, ...roads];
  }, [weather, closures]);

  const [index, setIndex] = useState(0);
  const active = alerts[index % Math.max(1, alerts.length)] ?? null;

  // Long enough to read the start, scroll the rest, and read the end.
  const [dwellMs, setDwellMs] = useState(12_000);

  useEffect(() => {
    if (alerts.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % alerts.length), dwellMs);
    return () => clearInterval(t);
  }, [alerts.length, dwellMs]);

  /**
   * Reveals the tail of a message too long for the bar.
   *
   * It holds at the start, slides just far enough to show the end, holds
   * again, then returns — rather than truncating with an ellipsis and leaving
   * the actual closure unread.
   */
  const viewport = useRef<HTMLDivElement | null>(null);
  const line = useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState(0);
  const [shifted, setShifted] = useState(false);

  /** Reading pace, pixels per second. Slow: this is read from a distance. */
  const SPEED = 26;
  /** How long it holds still at each end before moving. */
  const HOLD_MS = 3500;
  const travelMs = overflow > 0 ? (overflow / SPEED) * 1000 : 0;

  useEffect(() => {
    const measure = () => {
      const vp = viewport.current;
      const el = line.current;
      if (!vp || !el) return;
      setOverflow(Math.max(0, Math.ceil(el.scrollWidth - vp.clientWidth)));
    };
    measure();
    setShifted(false);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    if (viewport.current) ro.observe(viewport.current);
    return () => ro.disconnect();
  }, [active?.id, active?.text]);

  // Long messages need longer on screen than short ones, or the cycle swaps
  // one out before it has finished revealing itself.
  useEffect(() => {
    setDwellMs(Math.max(12_000, 2 * (HOLD_MS + travelMs) + 1_500));
  }, [travelMs]);

  // Hold at the start, slide to the end at reading pace, hold, come back.
  useEffect(() => {
    if (overflow <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const step = (next: boolean) => {
      setShifted(next);
      timer = setTimeout(() => step(!next), HOLD_MS + travelMs);
    };
    timer = setTimeout(() => step(true), HOLD_MS);
    return () => clearTimeout(timer);
  }, [overflow, travelMs, active?.id]);

  // Every alert ever chimed for, not just the last one: the banner cycles
  // between alerts, and remembering one id made it chime on every rotation.
  const chimed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active || !chimeEnabled) return;
    if (chimed.current.has(active.id)) return;
    if (inTimeWindow(dndFrom, dndTo)) return;
    chimed.current.add(active.id);

    // A short synthesized tone: no asset to ship, and it cannot 404.
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.85);
      osc.onended = () => void ctx.close();
    } catch {
      /* autoplay policy may block audio until the user interacts; not fatal */
    }
  }, [active, chimeEnabled, dndFrom, dndTo]);

  if (!active || dismissed) return null;

  return (
    <div className="breaking flex items-center gap-3 px-4 py-2" style={{ flex: "0 0 auto" }}>
      <span className="label" style={{ color: "inherit", fontWeight: 900 }}>
        {active.kind}
      </span>
      <div ref={viewport} className="flex-1" style={{ overflow: "hidden", minWidth: 0 }}>
        <span
          ref={line}
          key={active.id}
          className="text-sm font-bold"
          style={{
            display: "inline-block",
            whiteSpace: "nowrap",
            // The distance to travel is the part that does not fit, so a
            // message that only just overflows barely moves — and it moves at
            // the same pace whatever its length.
            transform: shifted ? `translateX(${-overflow}px)` : "translateX(0)",
            transition: `transform ${travelMs}ms linear`,
          }}
        >
          {active.text}
        </span>
      </div>
      {alerts.length > 1 && (
        <span className="label" style={{ color: "inherit", opacity: 0.8 }}>
          {(index % alerts.length) + 1}/{alerts.length}
        </span>
      )}
      <button onClick={onDismiss} className="label" style={{ color: "inherit" }} title="Dismiss">
        ✕
      </button>
    </div>
  );
}
