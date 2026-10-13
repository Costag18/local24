import { fetchJson } from "../http";
import { putBlob, upsertItems } from "../db";
import { loadConfig } from "../config";
import { itemId } from "../rss";
import { distanceKm } from "./cams";
import type { Item, TrafficEvent } from "../types";

/**
 * The City's own road restrictions, keyless and updated continuously.
 *
 * Ontario 511 closed its event API behind a key in September 2026, which left
 * this panel — and the breaking banner above it — showing three-week-old
 * closures. Toronto's feed is better suited anyway: it covers city streets and
 * the expressways, not just provincial highways.
 */
const TO_RESTRICTIONS = "https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json";

/** One row of Toronto's road restrictions feed. Numbers arrive as strings. */
export interface RawRestriction {
  id?: string;
  road?: string;
  name?: string;
  description?: string;
  latitude?: string;
  longitude?: string;
  roadClass?: string;
  type?: string;
  subType?: string;
  directionsAffected?: string;
  lastUpdated?: string;
  startTime?: string;
  expired?: number | string;
  atRoad?: string;
}

const SEVERITY_RANK: Record<string, number> = {
  major: 4, severe: 4, high: 3, moderate: 2, medium: 2, minor: 1, low: 1, unknown: 0,
};

export function severityScore(e: TrafficEvent): number {
  const base = SEVERITY_RANK[e.severity.toLowerCase()] ?? 0;
  return base + (e.isFullClosure ? 3 : 0) + (e.eventType === "accidentsAndIncidents" ? 2 : 0);
}

/**
 * A closure on an expressway matters more than one on a side street, and a
 * road shut in both directions more than a lane taken for roadwork.
 */
function severityOf(r: RawRestriction, fullClosure: boolean): string {
  const expressway = /express/i.test(r.roadClass ?? "");
  const arterial = /arterial/i.test(r.roadClass ?? "");
  if (fullClosure && (expressway || arterial)) return "Major";
  if (fullClosure) return "Moderate";
  if (expressway) return "Moderate";
  return arterial ? "Minor" : "Low";
}

export function parseEvents(rows: RawRestriction[]): TrafficEvent[] {
  return (rows ?? [])
    .filter((r) => String(r.expired ?? "0") !== "1")
    .map((r) => {
      const type = (r.type ?? "").toUpperCase();
      const fullClosure =
        type === "ROAD_CLOSED" || (r.subType ?? "").toUpperCase().includes("ROAD_CLOSED");
      const both = (r.directionsAffected ?? "").toUpperCase() === "BOTH_DIRECTIONS";
      return {
        id: String(r.id ?? ""),
        roadway: (r.road ?? "").trim(),
        // Not a compass bearing in this feed — what it says is how much of the
        // road is affected, which is the useful part on a one-line row.
        direction: both ? "both ways" : "",
        // "Toronto-TMC: " prefixes nearly every row and says nothing.
        description: (r.description ?? "").replace(/^[\w-]+-TMC:\s*/i, "").trim(),
        severity: severityOf(r, fullClosure),
        eventType: type.toLowerCase(),
        isFullClosure: fullClosure,
        lat: Number(r.latitude ?? 0),
        lon: Number(r.longitude ?? 0),
        updated: Number(r.lastUpdated ?? r.startTime ?? 0),
      };
    });
}

/**
 * The feed covers the whole city, which is mostly noise here. Events are kept
 * when they are near the user or on a named route.
 */
export function relevantEvents(
  events: TrafficEvent[],
  lat: number,
  lon: number,
  radiusKm: number,
  routes: string[],
): TrafficEvent[] {
  const upper = routes.map((r) => r.toUpperCase());
  return events
    .filter((e) => {
      const onRoute = upper.some((r) => e.roadway.toUpperCase().includes(r));
      const near =
        e.lat !== 0 && e.lon !== 0 && distanceKm(lat, lon, e.lat, e.lon) <= radiusKm;
      return onRoute || near;
    })
    .sort((a, b) => severityScore(b) - severityScore(a) || b.updated - a.updated);
}

/** Full closures on a named route are what raise the breaking banner. */
export function breakingClosures(events: TrafficEvent[], routes: string[]): TrafficEvent[] {
  const upper = routes.map((r) => r.toUpperCase());
  return events.filter(
    (e) => e.isFullClosure && upper.some((r) => e.roadway.toUpperCase().includes(r)),
  );
}

export async function ingestTraffic(): Promise<number> {
  const cfg = loadConfig();
  const raw = await fetchJson<{ Closure?: RawRestriction[] }>(
    "traffic.toronto",
    TO_RESTRICTIONS,
    45000,
  );
  if (!raw?.Closure) return 0;

  const all = parseEvents(raw.Closure);
  // A wider radius than the camera one: a closure 25km out still affects a drive.
  const relevant = relevantEvents(all, cfg.place.lat, cfg.place.lon, 25, cfg.routesOfInterest);

  putBlob("traffic", relevant.slice(0, 60));
  putBlob("traffic.breaking", breakingClosures(relevant, cfg.routesOfInterest).slice(0, 5));

  const now = Date.now();
  const items: Item[] = relevant.slice(0, 30).map((e) => ({
    id: itemId("traffic.toronto", `evt-${e.id}`, e.description),
    kind: "traffic" as const,
    sourceId: "traffic.toronto",
    title: [e.roadway, e.direction].filter(Boolean).join(" ") || "Traffic",
    body: e.description,
    link: "https://www.toronto.ca/services-payments/streets-parking-transportation/road-restrictions-closures/",
    published: e.updated || now,
    fetched: now,
    weight: severityScore(e),
    meta: { severity: e.severity, fullClosure: e.isFullClosure, lat: e.lat, lon: e.lon },
  }));
  return upsertItems(items);
}
