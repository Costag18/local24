"use client";

import { useEffect, useState } from "react";
import { shortDestination, shortStop, shortTime } from "@/lib/format";
import { routeColor } from "@/lib/routeColors";
import { Skeleton } from "./Skeleton";
import { affectsRoute, alertWord, type RouteAlert } from "@/lib/routeAlerts";

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
export function TransitBoard({
  routes, paused, now, alerts = [],
}: {
  routes: string[];
  paused: boolean;
  now: number;
  /** TTC alerts; any naming a route on the board flag its rows. */
  alerts?: RouteAlert[];
}) {
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
        <Skeleton rows={6} />
      ) : !rows.length ? (
        <div className="flex-1 grid place-items-center label">No stops yet</div>
      ) : (
        <div className="board-rows">
          {sorted.map((r) => {
            const next = r.times.filter((t) => t.at > now - 30_000).slice(0, 3);
            const color = routeColor(r.route, order(r.route));
            const trouble = alerts.filter((a) => affectsRoute(a, r.route));
            return (
              <div key={`${r.route}-${r.stop}`} className="board-row" title={`${r.stopTitle} · ${Math.round(r.km * 1000)} m`}>
                <span className="board-route" style={{ background: color }}>{r.route}</span>
                <span className="board-where">
                  <span className="board-dir wrap2">
                    {trouble.length > 0 && (
                      <span
                        className="tag board-alert"
                        title={trouble.map((t) => t.title).join(" · ")}
                        style={{ color: trouble.some((t) => !t.planned) ? "var(--accent)" : "var(--warn)" }}
                      >
                        {alertWord(trouble[0].title)}{" "}
                      </span>
                    )}
                    {r.heading}
                    {r.towards ? <span style={{ color: "var(--ink-dim)" }}> → {shortDestination(r.towards)}</span> : null}
                  </span>
                  <span className="label wrap2 board-stop" style={{ color: "var(--ink-faint)" }}>
                    {shortStop(r.stopTitle)} · {Math.round(r.km * 1000)} m
                  </span>
                </span>
                <span className="board-times">
                  {next.length ? (
                    next.map((t, i) => {
                      const min = Math.max(0, Math.round((t.at - now) / 60_000));
                      return (
                        // Keyed by the minute, so a changed time eases in
                        // rather than silently swapping digits.
                        <span
                          key={`${i}-${min}`}
                          className={`num board-time tick-in${i === 0 ? " board-first" : ""}`}
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
