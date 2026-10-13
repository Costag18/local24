import { fetchJson } from "../http";
import { getBlob, putBlob } from "../db";
import { loadConfig } from "../config";
import { distanceKm } from "./cams";

// The legacy keyless feed. `routeConfig` carries the drawn shape of each route
// and its stops; `vehicleLocations` carries live positions with heading.
const BASE = "https://retro.umoiq.com/service/publicJSONFeed?a=ttc";

export interface RouteShape {
  tag: string;
  title: string;
  color: string;
  /** Polylines in [lon, lat] pairs, ready to project. */
  paths: [number, number][][];
  stops: { lat: number; lon: number; title: string }[];
}

export interface Vehicle {
  id: string;
  route: string;
  lat: number;
  lon: number;
  heading: number;
  speedKmH: number;
  /** Seconds since the bus last reported, for staleness. */
  age: number;
  dir: string;
  /** Epoch ms of that report, so age survives an incremental merge. */
  reportedAt?: number;
}

interface RawPathPoint { lat?: string; lon?: string }
interface RawRoute {
  tag?: string; title?: string; color?: string;
  path?: { point?: RawPathPoint | RawPathPoint[] } | { point?: RawPathPoint | RawPathPoint[] }[];
  stop?: { lat?: string; lon?: string; title?: string; tag?: string }[];
  direction?: RawDirection | RawDirection[];
}
interface RawDirection { tag?: string; title?: string; name?: string; useForUI?: string; stop?: { tag?: string } | { tag?: string }[] }
interface RawVehicle {
  id?: string; routeTag?: string; lat?: string; lon?: string;
  heading?: string; speedKmHr?: string; secsSinceReport?: string; dirTag?: string;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseRouteConfig(raw: { route?: RawRoute }): RouteShape | null {
  const r = raw.route;
  if (!r?.tag) return null;

  const paths: [number, number][][] = [];
  for (const seg of asArray(r.path)) {
    const pts = asArray(seg?.point)
      .map((p) => [Number(p.lon), Number(p.lat)] as [number, number])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    if (pts.length > 1) paths.push(pts);
  }

  return {
    tag: r.tag,
    title: r.title ?? r.tag,
    // TTC ships a bare hex without the hash.
    color: r.color ? `#${String(r.color).replace(/^#/, "")}` : "#64748b",
    paths,
    stops: (r.stop ?? [])
      .map((s) => ({ lat: Number(s.lat), lon: Number(s.lon), title: s.title ?? "" }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)),
  };
}

/** The stop on one route and direction that is closest to home. */
export interface BoardStop {
  route: string;
  stop: string;
  /** "70_0": predictions are kept only for trips whose dirTag starts with it. */
  dir: string;
  /** "West", "North"… */
  heading: string;
  /** "Coxwell Station": where this direction is going. */
  towards: string;
  stopTitle: string;
  km: number;
}

/**
 * For each direction of a route, the stop nearest home — what the "next
 * buses" board shows. Directions the TTC hides from riders (short turns,
 * garage trips) are skipped. Pure.
 */
export function boardStops(raw: { route?: RawRoute }, home: { lat: number; lon: number }): BoardStop[] {
  const r = raw.route;
  if (!r?.tag) return [];
  const byTag = new Map(asArray(r.stop).map((s) => [s.tag ?? "", s]));
  const out: BoardStop[] = [];
  for (const d of asArray(r.direction)) {
    if (d.useForUI === "false" || !d.tag) continue;
    let best: BoardStop | null = null;
    for (const { tag } of asArray(d.stop)) {
      const s = byTag.get(tag ?? "");
      const lat = Number(s?.lat);
      const lon = Number(s?.lon);
      if (!s || !tag || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const km = distanceKm(home.lat, home.lon, lat, lon);
      if (!best || km < best.km) {
        best = {
          route: r.tag,
          stop: tag,
          dir: d.tag.split("_").slice(0, 2).join("_"),
          heading: d.name ?? "",
          towards: (/towards (.+)$/i.exec(d.title ?? "")?.[1] ?? "").trim(),
          stopTitle: s.title ?? "",
          km: Math.round(km * 100) / 100,
        };
      }
    }
    if (!best) continue;
    // Branches of one direction share stops ("towards Woodbine" and "towards
    // Woodbine via Eglinton"); one row each, named by the plainer of the two.
    const same = out.findIndex((o) => o.stop === best.stop && o.dir === best.dir);
    if (same < 0) out.push(best);
    else if (best.towards.length < out[same].towards.length) out[same] = best;
  }
  return out;
}

export function parseVehicles(raw: { vehicle?: RawVehicle | RawVehicle[] }): Vehicle[] {
  return asArray(raw.vehicle)
    .map((v) => ({
      id: String(v.id ?? ""),
      route: String(v.routeTag ?? ""),
      lat: Number(v.lat),
      lon: Number(v.lon),
      heading: Number(v.heading ?? 0),
      speedKmH: Number(v.speedKmHr ?? 0),
      age: Number(v.secsSinceReport ?? 0),
      dir: String(v.dirTag ?? ""),
    }))
    .filter(
      (v) =>
        v.id &&
        Number.isFinite(v.lat) &&
        Number.isFinite(v.lon) &&
        // A bus that has not reported in five minutes is not where it says.
        v.age < 300,
    );
}

/** Keeps only what is inside the map window, so distant routes cost nothing. */
export function withinBounds(
  v: { lat: number; lon: number },
  b: { latMin: number; latMax: number; lonMin: number; lonMax: number },
): boolean {
  return v.lat >= b.latMin && v.lat <= b.latMax && v.lon >= b.lonMin && v.lon <= b.lonMax;
}

/**
 * Route shapes change on service changes, not minute to minute, so they are
 * fetched rarely and cached; only vehicle positions are polled often.
 */
export async function ingestTtcShapes(): Promise<number> {
  const cfg = loadConfig();
  const shapes: RouteShape[] = [];
  const board: BoardStop[] = [];

  for (const tag of cfg.map.routes) {
    const raw = await fetchJson<{ route?: RawRoute }>(
      "ttcmap.shape",
      `${BASE}&command=routeConfig&r=${encodeURIComponent(tag)}`,
      25000,
    );
    if (!raw) continue;
    const shape = parseRouteConfig(raw);
    if (shape) shapes.push(shape);
    board.push(...boardStops(raw, cfg.home));
  }

  if (shapes.length) putBlob("ttc.shapes", shapes);
  if (board.length) putBlob("ttc.board", board);
  return shapes.length;
}

/**
 * Merges an incremental batch into what is already known.
 *
 * TTC reports in bursts, so a delta is either empty or nearly everything. New
 * positions replace old ones by vehicle id, and anything that has not reported
 * within `maxAgeMs` is dropped — a bus that stopped reporting is not still
 * sitting where it was last seen.
 */
export function mergeVehicles(
  previous: Vehicle[],
  batch: Vehicle[],
  now: number,
  maxAgeMs = 300_000,
): Vehicle[] {
  const byId = new Map<string, { v: Vehicle; seen: number }>();
  for (const v of previous) {
    // `reportedAt` rides along so age survives across merges.
    byId.set(v.id, { v, seen: (v as Vehicle & { reportedAt?: number }).reportedAt ?? now });
  }
  for (const v of batch) {
    byId.set(v.id, { v, seen: now - v.age * 1000 });
  }

  const out: Vehicle[] = [];
  for (const { v, seen } of byId.values()) {
    if (now - seen > maxAgeMs) continue;
    out.push({ ...v, age: Math.round((now - seen) / 1000), reportedAt: seen } as Vehicle);
  }
  return out;
}

/** How long a bus that has gone quiet stays on the map, dimmed, before it is dropped. */
const QUIET_MS = 150_000;

/**
 * Applies a batch of reports, then keeps only the buses the map follows.
 *
 * The order matters. Filtering the batch first meant a bus driving out of the
 * map area, or switched to another route, had its new report thrown away, so
 * its old marker sat frozen at the edge until it aged out. Merging first lets
 * that report land and the bus leave the map straight away. The stored set is
 * filtered too, so a change to the routes or the map area takes effect on the
 * next update.
 */
export function updateVehicles(
  previous: Vehicle[],
  batch: Vehicle[],
  now: number,
  wanted: (v: Vehicle) => boolean,
): Vehicle[] {
  return mergeVehicles(previous.filter(wanted), batch, now, QUIET_MS).filter(wanted);
}

/**
 * One request for the whole system, incrementally.
 *
 * Omitting the route parameter returns every vehicle TTC tracks (~1300 across
 * 171 routes) in a ~220KB response. Passing the previous `lastTime` asks only
 * for what has changed since: TTC batches roughly every ten seconds, so most
 * polls come back as 103 bytes. That makes a fast poll cheap — the bandwidth is
 * set by how often TTC publishes, not by how often this asks.
 */
export async function ingestTtcVehicles(): Promise<number> {
  const cfg = loadConfig();
  const since = getBlob<string>("ttc.lastTime")?.value ?? "0";

  const raw = await fetchJson<{ vehicle?: RawVehicle | RawVehicle[]; lastTime?: { time?: string } }>(
    "ttcmap.vehicles",
    `${BASE}&command=vehicleLocations&t=${encodeURIComponent(since)}`,
    30000,
  );
  if (!raw) return 0;

  const now = Date.now();
  // Only the routes the map is set to follow: everything else in the area is
  // noise on a map zoomed this far in.
  const follow = new Set(cfg.map.routes);
  const wanted = (v: Vehicle) => withinBounds(v, cfg.map.bounds) && (!follow.size || follow.has(v.route));
  const merged = updateVehicles(getBlob<Vehicle[]>("ttc.vehicles")?.value ?? [], parseVehicles(raw), now, wanted);

  if (raw.lastTime?.time) putBlob("ttc.lastTime", raw.lastTime.time);
  putBlob("ttc.vehicles", merged);
  return merged.length;
}

export function getShapes(): RouteShape[] {
  return getBlob<RouteShape[]>("ttc.shapes")?.value ?? [];
}

export function getVehicles(): { data: Vehicle[]; at: number } {
  const b = getBlob<Vehicle[]>("ttc.vehicles");
  return { data: b?.value ?? [], at: b?.at ?? 0 };
}
