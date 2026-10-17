import { fetchJson } from "../http";
import { putBlob } from "../db";
import { loadConfig } from "../config";
import { distanceKm } from "./cams";
import type { Weather } from "../types";

const EC = "https://api.weather.gc.ca/collections/citypageweather-realtime/items";
const OM = "https://api.open-meteo.com/v1/forecast";
const AQ = "https://air-quality-api.open-meteo.com/v1/air-quality";

/**
 * Environment Canada wraps leaves inconsistently: sometimes `{ en, fr }`,
 * sometimes `{ value: { en, fr } }`, and the nesting differs between stations
 * for the same field (wind.direction is flat at one and nested at another).
 * Unwrap both, repeatedly, and never stringify a leftover object.
 */
function bi(v: unknown): unknown {
  let cur = v;
  for (let i = 0; i < 4; i++) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return cur;
    const o = cur as Record<string, unknown>;
    if ("en" in o) cur = o.en;
    else if ("value" in o) cur = o.value;
    else return cur;
  }
  return cur;
}

function num(v: unknown): number | null {
  const raw = bi(v);
  if (raw === null || raw === undefined || raw === "" || typeof raw === "object") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  const raw = bi(v);
  // An object here means an unrecognised shape; an empty string beats "[object Object]".
  if (raw === null || raw === undefined || typeof raw === "object") return "";
  return String(raw);
}

function time(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function arr(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") return [v as Record<string, unknown>];
  return [];
}

function get(o: unknown, ...path: string[]): unknown {
  let cur: unknown = o;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export interface ECProps {
  name?: unknown;
  currentConditions?: Record<string, unknown>;
  forecastGroup?: Record<string, unknown>;
  hourlyForecastGroup?: Record<string, unknown>;
  warnings?: unknown;
  riseSet?: Record<string, unknown>;
}

/**
 * Environment Canada emits day and night as separate forecast entries, each
 * carrying a single temperature tagged `high` or `low`. They are folded back
 * into one row per day so the rail can show a CP24-style hi/lo strip.
 */
export function parseForecasts(forecasts: Record<string, unknown>[]): Weather["daily"] {
  const rows: Weather["daily"] = [];
  const indexByKey = new Map<string, number>();

  for (const f of forecasts) {
    const name = str(get(f, "period", "textForecastName")) || str(get(f, "period", "value"));
    if (!name) continue;

    const t = arr(get(f, "temperatures", "temperature"))[0];
    const value = num(t);
    const kind = str(get(t, "class")).toLowerCase();
    const isNight = kind === "low" || /night|tonight/i.test(name);

    // "Tonight" has no matching day entry, so it stands on its own.
    const key = /^tonight$/i.test(name) ? "Tonight" : name.replace(/\s*night$/i, "");
    const condition = str(get(f, "abbreviatedForecast", "textSummary")) || str(get(f, "textSummary"));
    const pop = num(get(f, "abbreviatedForecast", "pop"));

    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, rows.length);
      rows.push({
        day: key,
        hiC: isNight ? null : value,
        loC: isNight ? value : null,
        condition,
        pop,
      });
      continue;
    }

    const row = rows[existing];
    if (isNight) {
      row.loC = value;
      if (!row.condition) row.condition = condition;
    } else {
      row.hiC = value;
      row.condition = condition || row.condition; // the daytime summary wins
      if (row.pop === null) row.pop = pop;
    }
  }

  return rows;
}

/**
 * Environment Canada leaves a stale windChill in the payload through the warm
 * months (a 21C reading arrives alongside windChill -3), so each index is only
 * trusted inside the range it is defined for. Outside both, there is no
 * "feels like" and the caller shows nothing rather than a wrong number.
 */
export function feelsLike(tempC: number | null, humidex: number | null, windChill: number | null): number | null {
  if (tempC === null) return null;
  if (tempC >= 20 && humidex !== null) return humidex;
  if (tempC <= 0 && windChill !== null) return windChill;
  return null;
}

export function parseEnvCanada(props: ECProps): Omit<Weather, "aqi" | "nowcast"> {
  const cc = (props.currentConditions ?? {}) as Record<string, unknown>;
  const tempC = num(get(cc, "temperature"));

  const hourly = arr(get(props, "hourlyForecastGroup", "hourlyForecasts"))
    .slice(0, 12)
    .map((h) => ({
      at: time(h.timestamp) ?? Date.now(),
      tempC: num(get(h, "temperature")) ?? 0,
      condition: str(h.condition),
      pop: num(get(h, "lop")),
    }));

  // `warnings` is [] when clear, and either an array or a single object when not.
  const warnSource = props.warnings;
  const warnEvents = Array.isArray(warnSource)
    ? (warnSource as Record<string, unknown>[])
    : arr(get(warnSource, "event"));

  return {
    place: str(props.name),
    observed: time(get(cc, "timestamp")) ?? Date.now(),
    tempC,
    feelsLikeC: feelsLike(
      tempC,
      num(get(cc, "humidex")),
      num(get(cc, "windChill")),
    ),
    condition: str(cc.condition),
    iconUrl: (get(cc, "iconCode", "url") as string | undefined) ?? null,
    humidity: num(get(cc, "relativeHumidity")),
    windKph: num(get(cc, "wind", "speed")),
    windDir: str(get(cc, "wind", "direction")) || null,
    sunrise: time(get(props, "riseSet", "sunrise")),
    sunset: time(get(props, "riseSet", "sunset")),
    hourly,
    daily: parseForecasts(arr(get(props, "forecastGroup", "forecasts"))).slice(0, 5),
    warnings: warnEvents.map((e) => ({
      title: str(e.description) || str(e.type) || "Weather alert",
      type: str(e.type),
      url: str(e.url) || null,
    })),
  };
}

interface Feature {
  properties: ECProps;
  geometry?: { coordinates?: [number, number] };
}

/**
 * A bbox around the configured point returns several stations; the nearest one
 * is the right answer. Picking the first would label Toronto as "Toronto Island".
 */
export function nearestFeature(features: Feature[], lat: number, lon: number): Feature | null {
  let best: Feature | null = null;
  let bestD = Infinity;
  for (const f of features) {
    const c = f.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    const d = distanceKm(lat, lon, c[1], c[0]);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best ?? features[0] ?? null;
}

interface OMResp {
  minutely_15?: { time?: string[]; precipitation?: number[] };
  current?: { uv_index?: number };
}

export async function ingestWeather(): Promise<void> {
  const cfg = loadConfig();
  const { lat, lon, label } = cfg.place;
  const pad = 0.25;
  const bbox = `${lon - pad},${lat - pad},${lon + pad},${lat + pad}`;

  const [ec, om, aq] = await Promise.all([
    fetchJson<{ features?: Feature[] }>(
      "weather.ec",
      `${EC}?f=json&limit=10&bbox=${encodeURIComponent(bbox)}`,
    ),
    fetchJson<OMResp>(
      "weather.nowcast",
      `${OM}?latitude=${lat}&longitude=${lon}&minutely_15=precipitation&forecast_minutely_15=8&current=uv_index&timezone=auto`,
    ),
    fetchJson<{ current?: { us_aqi?: number } }>(
      "weather.aqi",
      `${AQ}?latitude=${lat}&longitude=${lon}&current=us_aqi`,
    ),
  ]);

  const feature = nearestFeature(ec?.features ?? [], lat, lon);
  if (!feature) return; // leave the previous blob in place; the tile shows it stale

  const base = parseEnvCanada(feature.properties);

  const nowcast: Weather["nowcast"] = [];
  const times = om?.minutely_15?.time ?? [];
  const mm = om?.minutely_15?.precipitation ?? [];
  for (let i = 0; i < Math.min(times.length, mm.length, 8); i++) {
    const t = Date.parse(times[i]);
    if (Number.isFinite(t)) nowcast.push({ at: t, mm: mm[i] ?? 0 });
  }

  putBlob("weather", {
    ...base,
    place: base.place || label,
    aqi: aq?.current?.us_aqi ?? null,
    uv: typeof om?.current?.uv_index === "number" ? Math.round(om.current.uv_index * 10) / 10 : null,
    nowcast,
  } satisfies Weather);
}
