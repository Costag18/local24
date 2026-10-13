"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Item, TrafficEvent } from "@/lib/types";

interface Props {
  tech: Item[];
  local: Item[];
  crime: Item[];
  traffic: TrafficEvent[];
  custom: string[];
  mix: { headlines: number; traffic: number; custom: number };
  speed: number;
}

export interface TickerEntry {
  key: string;
  tag: string;
  text: string;
  tone: "news" | "traffic" | "custom";
}

/**
 * Interleaves the three streams in the configured proportions rather than
 * concatenating them, so the crawl does not run twenty headlines then two
 * closures. Proportions are normalised, so any set of positive numbers works.
 */
export function composeTicker(
  headlines: Item[],
  traffic: TrafficEvent[],
  custom: string[],
  mix: { headlines: number; traffic: number; custom: number },
  total = 40,
): TickerEntry[] {
  const sum = Math.max(1e-6, mix.headlines + mix.traffic + mix.custom);
  const want = {
    headlines: Math.round((mix.headlines / sum) * total),
    traffic: Math.round((mix.traffic / sum) * total),
    custom: Math.round((mix.custom / sum) * total),
  };

  const pools: Record<TickerEntry["tone"], TickerEntry[]> = {
    news: headlines.slice(0, want.headlines).map((i) => ({
      key: `n-${i.id}`,
      tag: String(i.meta?.source ?? "NEWS"),
      text: i.title,
      tone: "news",
    })),
    traffic: traffic.slice(0, want.traffic).map((e) => ({
      key: `t-${e.id}`,
      tag: e.isFullClosure ? "CLOSED" : "TRAFFIC",
      text: `${e.roadway} ${e.direction} — ${e.description}`.trim(),
      tone: "traffic",
    })),
    custom: custom.slice(0, Math.max(want.custom, custom.length ? 1 : 0)).map((c, i) => ({
      key: `c-${i}`,
      tag: "LOCAL 24",
      text: c,
      tone: "custom",
    })),
  };

  // Round-robin weighted by how many of each remain.
  const out: TickerEntry[] = [];
  const order: TickerEntry["tone"][] = ["news", "traffic", "custom"];
  let guard = 0;
  while (out.length < total && guard++ < total * 4) {
    let moved = false;
    for (const tone of order) {
      const pool = pools[tone];
      if (!pool.length) continue;
      out.push(pool.shift() as TickerEntry);
      moved = true;
      if (out.length >= total) break;
    }
    if (!moved) break;
  }
  return out;
}

export function Ticker({ tech, local, crime, traffic, custom, mix, speed }: Props) {
  // The crawl is ambient, so it keeps moving while you work elsewhere on the
  // screen; it only holds still when the pointer is actually over it, which is
  // the moment you are trying to read something.
  const [hover, setHover] = useState(false);
  const entries = useMemo(
    () => composeTicker([...tech, ...crime, ...local], traffic, custom, mix),
    [tech, local, crime, traffic, custom, mix],
  );

  // One "lap" must be wider than the screen or the -50% translate reveals a
  // gap. Short lists are repeated until the lap is comfortably over-wide, so
  // the ribbon is continuous no matter how little data there is.
  const lap = useMemo(() => {
    const width = entries.reduce((n, e) => n + (e.text.length + e.tag.length + 6) * 7, 0);
    const target = typeof window === "undefined" ? 1920 : window.innerWidth * 1.5;
    const repeats = width > 0 ? Math.max(1, Math.ceil(target / width)) : 1;
    const out: TickerEntry[] = [];
    for (let r = 0; r < repeats; r++) {
      for (const e of entries) out.push({ ...e, key: `${r}-${e.key}` });
    }
    return out;
  }, [entries]);

  // Measured, not estimated. A character-count guess drifts badly with mixed
  // content and produced a seven-minute lap that looked frozen.
  const lapRef = useRef<HTMLSpanElement | null>(null);
  const [lapWidth, setLapWidth] = useState(0);

  useEffect(() => {
    const el = lapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setLapWidth(el.scrollWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lap]);

  const duration = useMemo(
    () => Math.max(10, lapWidth / Math.max(10, speed)),
    [lapWidth, speed],
  );

  if (!entries.length) {
    return (
      <div className="panel flex items-center px-3 py-2" style={{ flex: "0 0 auto" }}>
        <span className="label">Ticker waiting for data…</span>
      </div>
    );
  }

  const run = (copy: number) =>
    lap.map((e) => (
      <span key={`${copy}-${e.key}`} className="inline-flex items-center gap-2 px-3.5">
        <span
          className="tag"
          style={{
            color:
              e.tone === "traffic" ? "var(--warn)"
              : e.tone === "custom" ? "var(--ink-faint)"
              : "var(--accent)",
          }}
        >
          {e.tag}
        </span>
        <span className="text-sm" style={{ color: "var(--ink)" }}>{e.text}</span>
        <span style={{ color: "var(--rule)", fontSize: "0.7em" }}>◆</span>
      </span>
    ));

  return (
    <div
      className={`panel flex items-stretch ${hover ? "crawl-paused" : ""}`}
      style={{ flex: "0 0 auto", overflow: "hidden" }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <div
        className="flex items-center px-3 shrink-0"
        style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
      >
        <span className="label" style={{ color: "inherit", letterSpacing: "0.12em" }}>Now</span>
      </div>
      <div className="crawl-window relative flex-1 overflow-hidden py-2">
        <div className="crawl-track" style={{ animationDuration: `${duration}s` }}>
          <span ref={lapRef} className="inline-flex">{run(1)}</span>
          <span className="inline-flex" aria-hidden>{run(2)}</span>
        </div>
      </div>
    </div>
  );
}
