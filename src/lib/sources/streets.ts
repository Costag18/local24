import { getBlob, noteAttempt, noteFailure, noteSuccess, putBlob } from "../db";
import { loadConfig } from "../config";
import { ObjectSplitter } from "../jsonStream";

/**
 * Street outlines for the map, from the City's Toronto Centreline.
 *
 * Drawn faintly under the bus routes so the network reads against real
 * geography — major roads a little stronger than side streets. The City
 * classifies every segment (arterial, collector, local…), which is exactly the
 * major/minor split wanted. OpenStreetMap's Overpass service was the first
 * choice, but it is a shared community server that regularly answers "too
 * busy"; the City's open-data host serves the whole 90 MB file in seconds.
 *
 * Streets do not move: the file is read at most once a week, as a stream,
 * keeping only segments inside the map's bounds, and the stored copy is reused
 * across restarts.
 */
const FEED =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/1d079757-377b-4564-82df-eb5638583bfb" +
  "/resource/7bc94ccf-7bcf-4a7d-88b1-bdfc8ec5aaf1/download/centreline-version-2-4326.geojson";
const SOURCE = "streets.toronto";
const KEY = "map.streets";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Streets {
  /** The map area these were cut to; a different area means fetch again. */
  bounds?: Bounds;
  /** Expressways, arterials and collectors. */
  major: [number, number][][];
  /** Local streets. Laneways and trails are left out entirely. */
  minor: [number, number][][];
}

const MAJOR = new Set([
  "Expressway", "Expressway Ramp", "Major Arterial", "Major Arterial Ramp",
  "Minor Arterial", "Minor Arterial Ramp", "Collector", "Collector Ramp",
]);
const MINOR = new Set(["Local"]);

interface Bounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/**
 * Drops points closer than `step` degrees to the last one kept (about 8 m at
 * the default) and rounds to five decimals — a metre — which is far below what
 * a faint line at dashboard scale can show, and keeps the payload small.
 */
export function simplify(points: [number, number][], step = 0.00008): [number, number][] {
  const out: [number, number][] = [];
  for (const [i, [lon, lat]] of points.entries()) {
    const last = out[out.length - 1];
    const isEnd = i === points.length - 1;
    if (last && !isEnd && Math.abs(lon - last[0]) < step && Math.abs(lat - last[1]) < step) continue;
    out.push([Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
  }
  return out;
}

interface Feature {
  properties?: { FEATURE_CODE_DESC?: string };
  geometry?: { type?: string; coordinates?: unknown } | null;
}

/** Adds one centreline segment to the right bucket, if it is a street in view. */
export function addFeature(into: Streets, f: Feature, b: Bounds): void {
  const kind = f.properties?.FEATURE_CODE_DESC ?? "";
  const bucket = MAJOR.has(kind) ? into.major : MINOR.has(kind) ? into.minor : null;
  if (!bucket || !f.geometry) return;
  const lines = (f.geometry.type === "MultiLineString"
    ? f.geometry.coordinates
    : f.geometry.type === "LineString"
      ? [f.geometry.coordinates]
      : []) as [number, number][][];
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) continue;
    const inView = line.some(([lon, lat]) => lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax);
    if (!inView) continue;
    const simple = simplify(line);
    if (simple.length >= 2) bucket.push(simple);
  }
}

export async function ingestStreets(): Promise<number> {
  const bounds = loadConfig().map.bounds;
  const prev = getBlob<Streets>(KEY);
  const sameArea = JSON.stringify(prev?.value.bounds) === JSON.stringify(bounds);
  if (prev && sameArea && Date.now() - prev.at < MAX_AGE_MS && prev.value.major.length) return prev.value.major.length;

  noteAttempt(SOURCE);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5 * 60_000);
  try {
    const res = await fetch(FEED, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok || !res.body) {
      noteFailure(SOURCE, `HTTP ${res.status}`);
      return 0;
    }
    const streets: Streets = { bounds, major: [], minor: [] };
    const splitter = new ObjectSplitter();
    const decoder = new TextDecoder();
    const take = (objects: string[]) => {
      for (const text of objects) {
        try {
          addFeature(streets, JSON.parse(text) as Feature, bounds);
        } catch {
          /* one malformed segment is not worth failing the map over */
        }
      }
    };
    const reader = res.body.getReader();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      take(splitter.push(decoder.decode(value, { stream: true })));
    }
    take(splitter.push(decoder.decode()));

    if (!streets.major.length) {
      noteFailure(SOURCE, "no streets in view");
      return 0;
    }
    putBlob(KEY, streets);
    noteSuccess(SOURCE, Date.now() - started, bytes);
    return streets.major.length + streets.minor.length;
  } catch (err) {
    noteFailure(SOURCE, err instanceof Error ? err.message : String(err));
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

export function getStreets(): Streets {
  return getBlob<Streets>(KEY)?.value ?? { major: [], minor: [] };
}

export function streetsVersion(): number {
  return getBlob<unknown>(KEY)?.at ?? 0;
}
