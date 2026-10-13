import { getBlob, noteAttempt, noteFailure, noteSuccess, putBlob } from "../db";
import { loadConfig } from "../config";
import { distanceKm } from "./cams";
import type { LocalEvent } from "../types";
import { ObjectSplitter } from "../jsonStream";
import { webLink } from "../format";

export { ObjectSplitter as EventSplitter };

/**
 * The City's Festivals & Events calendar, from Toronto Open Data.
 *
 * The calendar's own query API sits behind bot protection that refuses
 * scripted requests, so the only usable copy is the open-data export — one
 * JSON file of every event the City has listed, past and future, at over
 * 200 MB. It is read as a stream and only the coming fortnight is kept, so
 * the whole file is never held in memory, and it is fetched twice a day.
 */
const FEED =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/9201059e-43ed-4369-885e-0b867652feac" +
  "/resource/8900fdb2-7f6c-4f50-8581-b463311ff05d/download/file.json";

const SOURCE = "events.toronto";
/** How far ahead to keep dates. The panel shows the coming week. */
const HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
/** An event that started this long ago still counts as "on now". */
export const EVENT_GRACE_MS = 2 * 60 * 60 * 1000;

interface RawEvent {
  submission_id?: string;
  id?: string;
  event_name?: string;
  event_status?: string;
  free_event?: string;
  featured_event?: string;
  event_category?: string[];
  event_website?: string | null;
  event_dates?: { date: number }[];
  event_locations?: { location_name?: string; location_address?: string; location_gps?: string }[];
}

/**
 * One calendar row as a `LocalEvent`, or null when it is not approved, has no
 * dates in the window, or is too far away to be "local" (unless the City
 * marks it featured — the big festivals are worth knowing about anywhere).
 */
export function toLocalEvent(
  raw: RawEvent,
  now: number,
  center: { lat: number; lon: number },
  radiusKm: number,
): LocalEvent | null {
  if (raw.event_status !== "Approved" || !raw.event_name) return null;
  const dates = (raw.event_dates ?? [])
    .map((d) => d.date)
    .filter((d) => typeof d === "number" && d >= now - EVENT_GRACE_MS && d <= now + HORIZON_MS)
    .sort((a, b) => a - b);
  if (!dates.length) return null;

  const loc = raw.event_locations?.[0] ?? {};
  let lat: number | null = null;
  let lon: number | null = null;
  try {
    const gps = JSON.parse(loc.location_gps || "[]") as { gps_lat?: number; gps_lng?: number }[];
    if (gps[0] && Number.isFinite(Number(gps[0].gps_lat)) && Number.isFinite(Number(gps[0].gps_lng))) {
      lat = Number(gps[0].gps_lat);
      lon = Number(gps[0].gps_lng);
    }
  } catch {
    /* no coordinates; distance stays unknown */
  }
  const distance = lat !== null && lon !== null ? distanceKm(center.lat, center.lon, lat, lon) : null;
  const featured = raw.featured_event === "Yes";
  if (!featured && (distance === null || distance > radiusKm)) return null;

  return {
    id: raw.submission_id || raw.id || raw.event_name,
    name: raw.event_name.trim(),
    venue: (loc.location_name || loc.location_address || "").trim(),
    distanceKm: distance === null ? null : Math.round(distance * 10) / 10,
    dates,
    free: raw.free_event === "Yes",
    featured,
    categories: raw.event_category ?? [],
    link: webLink(raw.event_website),
  };
}

/**
 * What the panel shows right now: each event at its next date, soonest first.
 * Applied when the state is built rather than at ingest, because "next date"
 * moves with the clock and the feed is only fetched twice a day.
 */
export function upcomingEvents(events: LocalEvent[], now = Date.now(), limit = 30): LocalEvent[] {
  const week = now + 7 * 24 * 60 * 60 * 1000;
  return events
    .map((e) => {
      const dates = e.dates.filter((d) => d >= now - EVENT_GRACE_MS);
      // Five or more dates this week reads as "on most days": an exhibit or a
      // run of shows. Those are worth knowing about, but they would otherwise
      // sit at the top of every single day's list.
      return { ...e, dates, link: webLink(e.link), ongoing: dates.filter((d) => d <= week).length >= 5 };
    })
    .filter((e) => e.dates.length > 0 && e.dates[0] <= week)
    .sort(
      (a, b) =>
        Number(a.ongoing) - Number(b.ongoing) ||
        a.dates[0] - b.dates[0] ||
        (a.distanceKm ?? 99) - (b.distanceKm ?? 99),
    )
    .slice(0, limit);
}

export async function ingestEvents(): Promise<number> {
  const cfg = loadConfig();
  const { center, radiusKm } = cfg.events;
  const now = Date.now();
  const prev = getBlob<{ events: LocalEvent[]; etag: string | null }>("events");
  // Job timers reset on every restart; the stored copy does not. Without this
  // each launch would download the whole 200 MB export again.
  if (prev && now - prev.at < 10 * 60 * 60 * 1000) return prev.value.events.length;

  noteAttempt(SOURCE);
  const started = Date.now();
  const ctrl = new AbortController();
  // A 200 MB download on a slow line takes a while; never let it hang forever.
  const timer = setTimeout(() => ctrl.abort(), 5 * 60_000);
  try {
    const res = await fetch(FEED, {
      signal: ctrl.signal,
      headers: prev?.value.etag ? { "if-none-match": prev.value.etag } : {},
      cache: "no-store",
    });
    if (res.status === 304 && prev) {
      noteSuccess(SOURCE, Date.now() - started, 0);
      return prev.value.events.length;
    }
    if (!res.ok || !res.body) {
      noteFailure(SOURCE, `HTTP ${res.status}`);
      return 0;
    }

    const splitter = new ObjectSplitter();
    const decoder = new TextDecoder();
    const byId = new Map<string, LocalEvent>();
    let bytes = 0;
    const take = (objects: string[]) => {
      for (const text of objects) {
        let raw: RawEvent;
        try {
          raw = JSON.parse(text) as RawEvent;
        } catch {
          continue;
        }
        const ev = toLocalEvent(raw, now, center, radiusKm);
        // The export repeats an event once per calendar day; keep one.
        if (ev && !byId.has(ev.id)) byId.set(ev.id, ev);
      }
    };

    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      take(splitter.push(decoder.decode(value, { stream: true })));
    }
    take(splitter.push(decoder.decode()));

    const events = [...byId.values()];
    putBlob("events", { events, etag: res.headers.get("etag") });
    noteSuccess(SOURCE, Date.now() - started, bytes);
    return events.length;
  } catch (err) {
    noteFailure(SOURCE, err instanceof Error ? err.message : String(err));
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
