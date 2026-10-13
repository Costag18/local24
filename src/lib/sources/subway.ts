import { fetchText } from "../http";
import { getBlob, putBlob } from "../db";
import { loadConfig } from "../config";

// OpenStreetMap. The TTC's own NextBus feed carries no subway routes at all —
// no tags 1/2/4 — so the lines have to come from somewhere else. OSM has them
// as route relations, with TTC's official colours already on the tags.
const OVERPASS = "https://overpass-api.de/api/interpreter";

export interface SubwayLine {
  /** "1", "2", "4". */
  ref: string;
  name: string;
  colour: string;
  /** Polylines in [lon, lat] pairs. */
  paths: [number, number][][];
  stations: { name: string; lat: number; lon: number }[];
}

interface OsmMember {
  type?: string;
  role?: string;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
}

interface OsmRelation {
  type?: string;
  tags?: Record<string, string>;
  members?: OsmMember[];
  /** Present on standalone nodes, which is how station names arrive. */
  lat?: number;
  lon?: number;
}

/** Official TTC colours, used when a relation is missing the tag. */
const FALLBACK_COLOUR: Record<string, string> = {
  "1": "#F8C300",
  "2": "#00923F",
  "4": "#A21A68",
};

/** Whether a standalone node is a station rather than, say, a level crossing. */
function isStationNode(tags: Record<string, string>): boolean {
  return (
    /^(stop_position|station|platform)$/.test(tags.public_transport ?? "") ||
    /^(station|stop|halt)$/.test(tags.railway ?? "")
  );
}

/**
 * `out geom;` gives a relation's ways their coordinates but strips member
 * tags, so station *names* only arrive as standalone node elements emitted
 * after the relation they belong to. Elements are therefore read in order: a
 * node attaches to the last relation seen.
 */
export function parseSubway(elements: OsmRelation[]): SubwayLine[] {
  const byRef = new Map<string, SubwayLine>();
  let current: SubwayLine | null = null;

  for (const rel of elements) {
    if (rel.type === "node") {
      const tags = rel.tags ?? {};
      const name = (tags.name ?? "").trim();
      if (
        current &&
        name &&
        isStationNode(tags) &&
        Number.isFinite(rel.lat) &&
        Number.isFinite(rel.lon) &&
        !current.stations.some((s) => s.name === name)
      ) {
        current.stations.push({ name, lat: rel.lat as number, lon: rel.lon as number });
      }
      continue;
    }
    if (rel.type !== "relation") continue;
    const ref = (rel.tags?.ref ?? "").trim();
    if (!ref) continue;

    const line: SubwayLine = byRef.get(ref) ?? {
      ref,
      // "Line 2 Bloor-Danforth (Kipling → Kennedy)" — the direction is noise.
      name: (rel.tags?.name ?? `Line ${ref}`).replace(/\s*\(.*\)\s*$/, ""),
      colour: rel.tags?.colour ?? rel.tags?.color ?? FALLBACK_COLOUR[ref] ?? "#94a3b8",
      paths: [],
      stations: [],
    };

    const seenStation = new Set(line.stations.map((s) => s.name));

    for (const m of rel.members ?? []) {
      if (m.type === "way" && Array.isArray(m.geometry) && m.geometry.length > 1) {
        line.paths.push(m.geometry.map((p) => [p.lon, p.lat] as [number, number]));
        continue;
      }
      // Each line is mapped once per direction, so the same platform appears
      // twice; keep one marker per station name.
      if (m.type === "node" && /stop|station/.test(m.role ?? "")) {
        const name = ((m as { tags?: Record<string, string> }).tags?.name ?? "").trim();
        if (
          Number.isFinite(m.lat) &&
          Number.isFinite(m.lon) &&
          name &&
          !seenStation.has(name)
        ) {
          seenStation.add(name);
          line.stations.push({ name, lat: m.lat as number, lon: m.lon as number });
        }
      }
    }

    byRef.set(ref, line);
    current = line;
  }

  return [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

/**
 * Fetched on the same slow cadence as the bus route shapes — a subway line
 * does not move. Overpass is a shared community service, so this must not be
 * polled often.
 */
export async function ingestSubway(): Promise<number> {
  const ids = loadConfig().map.subwayRelations;
  if (!ids.length) return 0;

  // One relation per request. A single query could return both, but station
  // nodes are matched to the relation that precedes them, and keeping the
  // requests separate makes that ordering guaranteed rather than assumed.
  const elements: OsmRelation[] = [];
  for (const [i, id] of ids.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2000)); // be a good citizen
    const query = `[out:json][timeout:120];rel(${id});out geom;node(r);out;`;
    const body = await fetchText(
      "subway.osm",
      `${OVERPASS}?data=${encodeURIComponent(query)}`,
      120_000,
    );
    if (!body) continue;
    try {
      elements.push(...((JSON.parse(body) as { elements?: OsmRelation[] }).elements ?? []));
    } catch {
      // A malformed response for one line must not lose the other.
    }
  }

  const lines = parseSubway(elements);
  if (!lines.length) return 0;

  // Overpass is a shared service and does throttle. A run that only got one of
  // the lines must not erase the other, so each line is replaced on its own.
  putBlob("subway.lines", mergeLines(getSubway(), lines));
  return lines.length;
}

export function mergeLines(previous: SubwayLine[], fresh: SubwayLine[]): SubwayLine[] {
  const byRef = new Map(previous.map((l) => [l.ref, l]));
  for (const l of fresh) byRef.set(l.ref, l);
  return [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

export function getSubway(): SubwayLine[] {
  return getBlob<SubwayLine[]>("subway.lines")?.value ?? [];
}
