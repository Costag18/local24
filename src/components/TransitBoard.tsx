"use client";

import { useEffect, useState } from "react";
import { shortStop, shortTime } from "@/lib/format";
import { routeColor } from "./TransitMap";

interface Row {
  route: string;
  stop: string;
  heading: string;
  towards: string;
  stopTitle: string;
  km: number;
  times: { at: number; vehicle: string; scheduled: boolean }[];
}

/**
 * Next buses near home: every followed route, both directions, at the stop
 * closest to home. The map's companion in the same window — the map says
 * where the buses are, this says when one reaches you.
 *
 * Minutes are the big number; a "~" marks a time the TTC is only guessing from
 * the schedule because the bus is still finishing its previous trip.
 */
export function TransitBoard({ routes, paused, now }: { routes: string[]; paused: boolean; now: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void fetch("/api/board", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { rows: Row[] }) => !cancelled && setRows(d.rows))
        .catch(() => undefined);
    load();
    const t = setInterval(load, paused ? 120_000 : 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [paused]);

  const order = (r: string) => {
    const i = routes.indexOf(r);
    return i < 0 ? 99 : i;
  };
  const sorted = [...(rows ?? [])].sort((a, b) => order(a.route) - order(b.route) || a.heading.localeCompare(b.heading));

  return (
    <section className="panel flex flex-col board" style={{ minHeight: 0 }}>
      <div className="slab">
        <span className="label label-accent shrink-0 slab-name">Next buses</span>
        <span className="label truncate">nearest stop each way</span>
      </div>
      {!rows ? (
        <div className="flex-1 grid place-items-center label">Loading…</div>
      ) : !rows.length ? (
        <div className="flex-1 grid place-items-center label">No stops yet</div>
      ) : (
        <div className="board-rows">
          {sorted.map((r) => {
            const next = r.times.filter((t) => t.at > now - 30_000).slice(0, 3);
            const color = routeColor(r.route, order(r.route));
            return (
              <div key={`${r.route}-${r.stop}`} className="board-row">
                <span className="board-route" style={{ background: color }}>{r.route}</span>
                <span className="board-where">
                  <span className="board-dir wrap2">
                    {r.heading}
                    {r.towards ? <span style={{ color: "var(--ink-dim)" }}> → {r.towards}</span> : null}
                  </span>
                  <span className="label wrap2" style={{ color: "var(--ink-faint)" }} title={r.stopTitle}>
                    {shortStop(r.stopTitle)} · {Math.round(r.km * 1000)} m
                  </span>
                </span>
                <span className="board-times">
                  {next.length ? (
                    next.map((t, i) => {
                      const min = Math.max(0, Math.round((t.at - now) / 60_000));
                      return (
                        <span
                          key={i}
                          className={`num board-time${i === 0 ? " board-first" : ""}`}
                          title={`${shortTime(t.at)}${t.scheduled ? " (scheduled)" : ""}`}
                          style={{ color: i === 0 ? (min <= 2 ? "var(--warn)" : "var(--ink)") : "var(--ink-dim)" }}
                        >
                          {t.scheduled ? "~" : ""}
                          {min === 0 ? "Now" : min}
                          {i === 0 && min > 0 ? <span className="board-unit"> min</span> : null}
                        </span>
                      );
                    })
                  ) : (
                    <span className="label" style={{ color: "var(--ink-faint)" }}>no service</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
