"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ago, compactTime } from "@/lib/format";
import { expandToAspect, unwrapHeading } from "@/lib/shape";
import { useBox } from "./hooks";

interface Viewport {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

interface Shape {
  tag: string;
  title: string;
  color: string;
  paths: [number, number][][];
  stops: { lat: number; lon: number; title: string }[];
}

interface Vehicle {
  id: string;
  route: string;
  lat: number;
  lon: number;
  heading: number;
  speedKmH: number;
  age: number;
}

interface MapData {
  label: string;
  bounds: Viewport;
  /** The fixed window shown. The map does not pan. */
  view: Viewport;
  showStops: boolean;
  shapes: Shape[];
  /** Faint street outlines from OpenStreetMap, in [lon, lat]. */
  streets?: { major: [number, number][][]; minor: [number, number][][] };
  vehicles: Vehicle[];
  vehiclesAt: number;
  cameras: { id: string; lat: number; lon: number; label: string; dead: boolean }[];
  incidents: { id: string; lat: number; lon: number; roadway: string; description: string; fullClosure: boolean }[];
  /** Bumps when the geometry is re-fetched, which is twice a day. */
  staticVersion: number;
}

/** What the five-second poll actually needs: everything that moves. */
type MapLive = Pick<MapData, "vehicles" | "vehiclesAt" | "cameras" | "incidents" | "staticVersion">;

/**
 * The canvas's long side, in SVG units. The short side follows the window's
 * proportions, so the picture is never cropped or letterboxed; markers are
 * sized in these units and so stay in proportion to the window.
 */
const LONG_SIDE = 1000;

/**
 * TTC returns the same maroon for nearly every bus route, which makes an
 * overlapping network unreadable. Routes are recoloured from a categorical
 * palette by position so neighbouring lines stay distinguishable.
 */
const PALETTE = [
  "#38bdf8", "#f59e0b", "#22c55e", "#e879f9", "#f87171",
  "#a3e635", "#60a5fa", "#fb923c", "#2dd4bf", "#c084fc",
  "#facc15", "#fb7185", "#93c5fd", "#fdba74",
];

export function routeColor(tag: string, index: number): string {
  // Keep the real line colours for the subway, which TTC does set correctly.
  if (tag === "1") return "#f8d40a";
  if (tag === "2") return "#00a651";
  if (tag === "4") return "#a21d68";
  return PALETTE[index % PALETTE.length];
}

/**
 * Projects the data area into a fixed canvas, once per load.
 *
 * The visible window is then an SVG transform over that canvas, so the ~9,000
 * points of route geometry are never re-projected on a re-render.
 * Equirectangular with a cosine correction is accurate over a few kilometres
 * and needs no projection library.
 */
function fullProjector(b: Viewport, canvas: number) {
  const midLat = ((b.latMin + b.latMax) / 2) * (Math.PI / 180);
  const kx = Math.cos(midLat);
  const spanX = (b.lonMax - b.lonMin) * kx;
  const spanY = b.latMax - b.latMin;
  const scale = canvas / Math.max(spanX, spanY);

  return {
    project: (lon: number, lat: number): [number, number] => [
      (lon - b.lonMin) * kx * scale,
      // SVG y grows downward; latitude grows upward.
      (b.latMax - lat) * scale,
    ],
    unproject: (x: number, y: number): [number, number] => [
      b.lonMin + x / (kx * scale),
      b.latMax - y / scale,
    ],
  };
}

export function TransitMap({ now, paused }: { now: number; paused: boolean }) {
  const [data, setData] = useState<MapData | null>(null);
  const [hoverRoute, setHoverRoute] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [mapRef, box] = useBox<HTMLDivElement>();
  // The canvas takes the window's own proportions, landscape or portrait.
  const aspect = box.w > 0 && box.h > 0 ? box.w / box.h : 1000 / 620;
  const W = aspect >= 1 ? LONG_SIDE : Math.round(LONG_SIDE * aspect);
  const H = aspect >= 1 ? Math.round(LONG_SIDE / aspect) : LONG_SIDE;

  /**
   * Geometry once, vehicles often.
   *
   * The route shapes are 330KB and change twice a day; the
   * vehicles are 15KB and change every five seconds. The poll therefore asks
   * only for what moves, and re-reads the geometry when the version it carries
   * says the server has new shapes.
   */
  useEffect(() => {
    let cancelled = false;
    let version = -1;

    const loadAll = async () => {
      const r = await fetch("/api/map", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as MapData;
      if (cancelled) return;
      version = d.staticVersion;
      setData(d);
      setError(false);
    };

    const loadLive = async () => {
      try {
        const r = await fetch("/api/map?only=live", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const live = (await r.json()) as MapLive;
        if (cancelled) return;
        if (live.staticVersion !== version) {
          await loadAll();
          return;
        }
        // Only the moving fields are replaced, so the projected geometry and
        // the path strings built from it survive untouched.
        setData((prev) => (prev ? { ...prev, ...live } : prev));
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    };

    void loadAll().catch(() => {
      if (!cancelled) setError(true);
    });
    const t = setInterval(() => void loadLive(), paused ? 60_000 : 5_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [paused]);

  // Keyed on the bounds themselves: a live update replaces the vehicles, and
  // re-projecting 9,000 points every five seconds for that would be waste.
  const proj = useMemo(
    () => (data ? fullProjector(data.bounds, 4000) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.bounds.latMin, data?.bounds.latMax, data?.bounds.lonMin, data?.bounds.lonMax],
  );

  // The network as path data — built once per data load.
  const routeLayer = useMemo(() => {
    if (!data || !proj) return [];
    return data.shapes.map((s, si) => ({
      tag: s.tag,
      color: routeColor(s.tag, si),
      d: s.paths
        .map((path) =>
          path
            .map(([lon, lat], i) => {
              const [x, y] = proj.project(lon, lat);
              return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(""),
        )
        .join(" "),
    }));
    // Keyed on the geometry, not the whole payload: a five-second vehicle
    // update leaves `shapes` identical, and rebuilding 9,000 points of path
    // data for it was the map's largest recurring cost.
  }, [data?.shapes, proj]);

  /** Streets as two path strings — one per weight — built once per load. */
  const streetLayer = useMemo(() => {
    if (!data?.streets || !proj) return null;
    const toPath = (lines: [number, number][][]) =>
      lines
        .map((line) =>
          line
            .map(([lon, lat], i) => {
              const [x, y] = proj.project(lon, lat);
              return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(""),
        )
        .join(" ");
    return { major: toPath(data.streets.major), minor: toPath(data.streets.minor) };
  }, [data?.streets, proj]);

  /**
   * What is actually on screen: the configured view, grown along whichever
   * axis the window has spare so a tall, slim window shows more streets north
   * and south rather than a sliver of the middle.
   */
  const view = useMemo<Viewport | null>(() => {
    const v = data?.view;
    const b = data?.bounds;
    if (!v || !b || !proj) return v ?? null;
    const [vx0, vy1] = proj.project(v.lonMin, v.latMin);
    const [vx1, vy0] = proj.project(v.lonMax, v.latMax);
    const [bx0, by1] = proj.project(b.lonMin, b.latMin);
    const [bx1, by0] = proj.project(b.lonMax, b.latMax);
    const e = expandToAspect(
      { x0: vx0, y0: vy0, x1: vx1, y1: vy1 },
      W / H,
      { x0: bx0, y0: by0, x1: bx1, y1: by1 },
    );
    const [lonMin, latMax] = proj.unproject(e.x0, e.y0);
    const [lonMax, latMin] = proj.unproject(e.x1, e.y1);
    return { lonMin, lonMax, latMin, latMax };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.view, data?.bounds, proj, W, H]);

  /** Maps the projected canvas onto the visible window. */
  const camera = useMemo(() => {
    if (!view || !proj) return null;
    const [x0, y1] = proj.project(view.lonMin, view.latMin);
    const [x1, y0] = proj.project(view.lonMax, view.latMax);
    const vw = Math.max(1, x1 - x0);
    const vh = Math.max(1, y1 - y0);
    const s = Math.min(W / vw, H / vh);
    const tx = -x0 * s + (W - vw * s) / 2;
    const ty = -y0 * s + (H - vh * s) / 2;
    return {
      s,
      tx,
      ty,
      toScreen: (lon: number, lat: number): [number, number] => {
        const [px, py] = proj.project(lon, lat);
        return [px * s + tx, py * s + ty];
      },
    };
  }, [view, proj, W, H]);

  const routeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of data?.vehicles ?? []) m.set(v.route, (m.get(v.route) ?? 0) + 1);
    return m;
  }, [data?.vehicles]);

  const inView = <T extends { lat: number; lon: number }>(items: T[]): T[] => {
    if (!view) return [];
    return items.filter(
      (i) => i.lat >= view.latMin && i.lat <= view.latMax && i.lon >= view.lonMin && i.lon <= view.lonMax,
    );
  };

  // Only what is on screen gets a marker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleBuses = useMemo(() => inView(data?.vehicles ?? []), [data?.vehicles, view]);

  /** Route colour by tag, worked out once per load rather than per bus per update. */
  const colourOf = useMemo(() => {
    const m = new Map<string, string>();
    (data?.shapes ?? []).forEach((s, i) => m.set(s.tag, routeColor(s.tag, i)));
    return (tag: string) => m.get(tag) ?? routeColor(tag, 0);
  }, [data?.shapes]);

  /**
   * Headings without the wrap-around.
   *
   * Buses glide between positions and turn smoothly (see `.bus` in the CSS).
   * A turn from 350° to 10° must animate as 20° right, not 340° left, so each
   * bus's angle is carried on continuously from the one it had before.
   */
  const lastHeading = useRef(new Map<string, number>());
  const headings = useMemo(() => {
    const out = new Map<string, number>();
    for (const v of visibleBuses) {
      out.set(v.id, unwrapHeading(lastHeading.current.get(v.id), v.heading));
    }
    lastHeading.current = out;
    return out;
  }, [visibleBuses]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleIncidents = useMemo(() => inView(data?.incidents ?? []), [data?.incidents, view]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleCameras = useMemo(() => inView(data?.cameras ?? []), [data?.cameras, view]);

  return (
    <section className="panel flex flex-col" style={{ minHeight: 0 }}>
      <div className="slab">
        <span className="label label-accent shrink-0 slab-name">Map</span>
        <span className="label truncate" style={{ color: "var(--ink)", minWidth: 0 }}>
          {data?.label ?? "—"}
        </span>
        <span className="flex-1" />
        <span className="live-dot shrink-0" />
        <span className="label num shrink-0">{visibleBuses.length}</span>
      </div>

      <div ref={mapRef} className="relative flex-1" style={{ minHeight: 0, background: "var(--panel)" }}>
        {!data || !camera ? (
          <div className="absolute inset-0 grid place-items-center label">
            {error ? "Map unavailable" : "Loading map…"}
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          >
            {/* Streets first, underneath everything: light grey and faint, side
                streets fainter still, so they give the map its geography
                without competing with the routes drawn over them. */}
            {streetLayer && (
              <g
                transform={`translate(${camera.tx.toFixed(2)} ${camera.ty.toFixed(2)}) scale(${camera.s.toFixed(5)})`}
                fill="none"
                stroke="#d4d8de"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={streetLayer.minor} strokeWidth={1} opacity={0.05} vectorEffect="non-scaling-stroke" />
                <path d={streetLayer.major} strokeWidth={1.6} opacity={0.1} vectorEffect="non-scaling-stroke" />
              </g>
            )}

            {/* The route network, placed by a single transform. */}
            <g transform={`translate(${camera.tx.toFixed(2)} ${camera.ty.toFixed(2)}) scale(${camera.s.toFixed(5)})`}>
              <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                {routeLayer.map((r) => {
                  const dim = hoverRoute !== null && hoverRoute !== r.tag;
                  return (
                    <path
                      key={r.tag}
                      d={r.d}
                      stroke={r.color}
                      strokeWidth={hoverRoute === r.tag ? 4 : 2}
                      opacity={dim ? 0.1 : 0.45}
                      // Line weight must not grow with the zoom.
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </g>
            </g>

            {/* Markers are placed per frame so they keep a constant size. */}
            {visibleCameras.map((c) => {
              const [x, y] = camera.toScreen(c.lon, c.lat);
              return (
                <rect
                  key={c.id}
                  x={x - 3}
                  y={y - 3}
                  width={6}
                  height={6}
                  fill="none"
                  stroke={c.dead ? "var(--dead)" : "var(--ink-faint)"}
                  strokeWidth={1.5}
                >
                  <title>{c.label}</title>
                </rect>
              );
            })}

            {visibleIncidents.map((e) => {
              const [x, y] = camera.toScreen(e.lon, e.lat);
              return (
                <g key={e.id}>
                  <circle cx={x} cy={y} r={e.fullClosure ? 12 : 9} fill="var(--accent)" opacity={0.18} />
                  <circle cx={x} cy={y} r={4} fill="var(--accent)">
                    <title>{`${e.roadway} — ${e.description}`}</title>
                  </circle>
                </g>
              );
            })}

            {visibleBuses.map((v) => {
              const [x, y] = camera.toScreen(v.lon, v.lat);
              const color = colourOf(v.route);
              const stale = v.age > 90;
              return (
                // Position and heading are CSS transforms, not SVG attributes,
                // so a new report glides the marker there instead of jumping.
                <g
                  key={v.id}
                  className="bus"
                  style={{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` }}
                  opacity={stale ? 0.4 : 1}
                  onMouseEnter={() => setHoverRoute(v.route)}
                  onMouseLeave={() => setHoverRoute(null)}
                >
                  <circle r={18} fill={color} opacity={0.2} />
                  <g className="bus-heading" style={{ transform: `rotate(${(headings.get(v.id) ?? v.heading).toFixed(1)}deg)` }}>
                    <path
                      d="M 0 -15 L 10.5 12 L 0 6 L -10.5 12 Z"
                      fill={color}
                      stroke="#04070d"
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  </g>
                  {/* Outside the rotating group, so it stays upright. */}
                  <text
                    y={-22}
                    textAnchor="middle"
                    fontSize={21}
                    fontWeight={800}
                    fill={color}
                    stroke="#04070d"
                    strokeWidth={4}
                    paintOrder="stroke"
                  >
                    {v.route}
                  </text>
                  <title>{`${v.route} · ${Math.round(v.speedKmH)} km/h · reported ${v.age}s ago`}</title>
                </g>
              );
            })}
          </svg>
        )}

        {/* Route legend doubles as a filter on hover. */}
        {data && routeLayer.length > 0 && (
          <div
            className="absolute left-0 right-0 bottom-0 flex flex-wrap gap-x-2 px-2 py-1"
            style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.88) 55%)" }}
          >
            {routeLayer.map((r) => (
              <button
                key={r.tag}
                className="tag"
                onMouseEnter={() => setHoverRoute(r.tag)}
                onMouseLeave={() => setHoverRoute(null)}
                style={{ color: routeCounts.get(r.tag) ? r.color : "var(--ink-faint)" }}
                title={`${r.tag} · ${routeCounts.get(r.tag) ?? 0} in area`}
              >
                {r.tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <Departures paused={paused} now={now} />
    </section>
  );
}

interface StopTimes {
  label: string;
  route: string;
  times: { at: number; vehicle: string; scheduled: boolean }[];
}

/**
 * The next buses at the stops you use, in a strip under the map.
 *
 * Minutes are what you act on; the clock time sits beside them faintly. A
 * time the TTC is only estimating from the schedule — the bus is still on its
 * previous trip — is marked with a "~".
 */
function Departures({ paused, now }: { paused: boolean; now: number }) {
  const [stops, setStops] = useState<StopTimes[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void fetch("/api/departures", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { stops?: StopTimes[] }) => {
          if (!cancelled) setStops(d.stops ?? []);
        })
        .catch(() => undefined);
    load();
    const t = setInterval(load, paused ? 120_000 : 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [paused]);

  if (!stops.length) return null;

  return (
    <div className="flex flex-col" style={{ borderTop: "1px solid var(--line)", flex: "0 0 auto" }}>
      {stops.map((s) => {
        const upcoming = s.times.filter((t) => t.at > now - 30_000).slice(0, 4);
        return (
          <div key={`${s.route}-${s.label}`} className="flex items-center gap-3 px-2 py-1" style={{ minWidth: 0 }}>
            <span className="label label-accent shrink-0">{s.label}</span>
            {upcoming.length === 0 ? (
              <span className="label" style={{ color: "var(--ink-faint)" }}>No buses predicted</span>
            ) : (
              upcoming.map((t) => {
                const min = Math.max(0, Math.round((t.at - now) / 60_000));
                return (
                  <span key={`${t.vehicle}-${t.at}`} className="flex items-baseline gap-1 shrink-0" title={`Bus ${t.vehicle}`}>
                    <span className="figure font-bold text-sm" style={{ color: min <= 5 ? "var(--warn)" : "var(--ink)" }}>
                      {t.scheduled ? "~" : ""}{min === 0 ? "Due" : `${min} min`}
                    </span>
                    <span className="label num" style={{ color: "var(--ink-faint)" }}>{compactTime(t.at)}</span>
                  </span>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
