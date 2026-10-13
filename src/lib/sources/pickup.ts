import { getBlob, putBlob } from "../db";
import { loadConfig } from "../config";
import { fetchJson, fetchText } from "../http";

/**
 * Garbage, recycling and green bin days, from the City's own schedule.
 *
 * Two keyless City sources: an ArcGIS layer that says which collection
 * calendar a point belongs to ("Thursday2"), and the open-data schedule that
 * lists, per calendar, every collection date of the year and what goes out.
 * Holiday shifts are already baked into the dates — Christmas-week pickups
 * show up on the Saturday — so no holiday logic is needed here.
 */
const ZONES =
  "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial21/FeatureServer/3/query";
const PACKAGE =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=solid-waste-pickup-schedule";
const KEY = "pickup";

import type { Pickup } from "../types";

interface Stored {
  calendar: string;
  home: { lat: number; lon: number };
  dates: Pickup[];
}

/** The schedule's columns, in the words on the bins. */
const STREAMS: [column: string, label: string][] = [
  ["Garbage", "Garbage"],
  ["Recycling", "Recycling"],
  ["GreenBin", "Green Bin"],
  ["YardWaste", "Yard Waste"],
  ["ChristmasTree", "Tree"],
];

/**
 * One calendar's dates from the schedule CSV. A stream is collected that week
 * when its column holds a day letter; "0" means not.
 */
export function parseSchedule(csv: string, calendar: string): Pickup[] {
  const lines = csv.trim().split(/\r?\n/);
  const head = (lines.shift() ?? "").split(",").map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const iCal = col("Calendar");
  const iDate = col("WeekStarting");
  if (iCal < 0 || iDate < 0) return [];

  const out: Pickup[] = [];
  for (const line of lines) {
    const f = line.split(",").map((v) => v.trim());
    if (f[iCal]?.toLowerCase() !== calendar.toLowerCase()) continue;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(f[iDate] ?? "");
    if (!m) continue;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const items = STREAMS.filter(([c]) => {
      const v = f[col(c)];
      return v !== undefined && v !== "" && v !== "0";
    }).map(([, label]) => label);
    if (!items.length) continue;
    out.push({ date: `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`, items });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Today's date as the schedule writes it, in local time. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The next `count` collections, today's included. Computed against the clock. */
export function nextPickups(dates: Pickup[], now: number, count = 2): Pickup[] {
  const today = localDate(now);
  return dates.filter((p) => p.date >= today).slice(0, count);
}

async function lookupCalendar(lat: number, lon: number): Promise<string | null> {
  const q = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "AREA_NAME",
    returnGeometry: "false",
    f: "json",
  });
  const json = await fetchJson<{ features?: { attributes?: { AREA_NAME?: string } }[] }>(
    "pickup.zone",
    `${ZONES}?${q}`,
    15_000,
  );
  return json?.features?.[0]?.attributes?.AREA_NAME ?? null;
}

/** This year's and (once the City posts it) next year's schedule CSVs. */
async function scheduleCsvs(): Promise<string[]> {
  const pkg = await fetchJson<{ result?: { resources?: { name?: string; url?: string; datastore_active?: boolean }[] } }>(
    "pickup.schedule",
    PACKAGE,
    15_000,
  );
  const year = new Date().getFullYear();
  const wanted = [`pickup-schedule-${year}`, `pickup-schedule-${year + 1}`];
  const urls = (pkg?.result?.resources ?? [])
    .filter((r) => r.datastore_active && r.url && wanted.includes(r.name ?? ""))
    .map((r) => r.url as string);
  const texts = await Promise.all(urls.map((u) => fetchText("pickup.schedule", u, 30_000)));
  return texts.filter((t): t is string => Boolean(t));
}

/**
 * Refreshed daily, but the schedule is annual: the job does real work only
 * when the home point or calendar changes, or the stored dates run low.
 */
export async function ingestPickup(): Promise<number> {
  const cfg = loadConfig();
  const home = { lat: cfg.home.lat, lon: cfg.home.lon };
  const prev = getBlob<Stored>(KEY)?.value;
  const samePlace = prev && prev.home.lat === home.lat && prev.home.lon === home.lon;
  const calendar = cfg.pickupCalendar.trim() || (samePlace ? prev.calendar : null) || (await lookupCalendar(home.lat, home.lon));
  if (!calendar) return 0;

  const upcoming = prev ? nextPickups(prev.dates, Date.now(), 99).length : 0;
  if (prev && samePlace && prev.calendar === calendar && upcoming > 4) return upcoming;

  const dates = (await scheduleCsvs()).flatMap((csv) => parseSchedule(csv, calendar));
  if (!dates.length) return 0;
  putBlob(KEY, { calendar, home, dates } satisfies Stored);
  return dates.length;
}

export function getPickups(now = Date.now()): { calendar: string; next: Pickup[] } {
  const b = getBlob<Stored>(KEY)?.value;
  return { calendar: b?.calendar ?? "", next: b ? nextPickups(b.dates, now) : [] };
}
