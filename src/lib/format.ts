import type { Weather } from "./types";

/** Shared display helpers. Kept pure so they can be unit-tested. */

export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function longDate(ms: number): string {
  return new Date(ms)
    .toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();
}

export function shortTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** "3m ago" / "just now". Powers the staleness marker on every tile. */
export function ago(ms: number, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Countdown to a fight card: "3h 12m", "in 4 days", "LIVE NOW". */
/**
 * How long a fight card runs from the main-card start.
 *
 * Lives here rather than beside the scraper because both the countdown and the
 * "has it finished" filter need it, and this module is the one both sides can
 * import — pulling lib/sources into a component drags node built-ins into the
 * browser bundle.
 */
export const CARD_RUNTIME_MS = 5.5 * 60 * 60 * 1000;

export function until(target: number | null, now = Date.now()): string {
  if (target === null) return "TBA";
  const diff = target - now;
  if (diff <= 0) return diff > -CARD_RUNTIME_MS ? "LIVE NOW" : "ENDED";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** "6:50a" — fits the narrow sunrise/sunset cell without wrapping. */
export function compactTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m}${h < 12 ? "a" : "p"}`;
}

export function temp(c: number | null): string {
  return c === null || !Number.isFinite(c) ? "--" : `${Math.round(c)}°`;
}

/**
 * Shortens a camera name for a narrow thumbnail.
 *
 * "DANFORTH AVE @ BROADVIEW AVE" does not fit a 108px tile at any readable
 * size, but the street types carry no information here — the intersection is
 * the whole point. The disambiguating "#8215" suffix is dropped too; it stays
 * in the tooltip.
 */
const STREET_TYPES =
  /^(AVENUE|AVE|STREET|ROAD|RD|BOULEVARD|BLVD|DRIVE|DR|CRESCENT|CRES|PARKWAY|PKWY|COURT|CRT|TERRACE|TER|LANE|LN|WAY|GATE|TRAIL|CIRCLE|CIR)\.?$/i;

/** "ST" is a street type mid-name, but "Saint" when it leads one. */
function isStreetType(token: string, index: number): boolean {
  if (/^ST\.?$/i.test(token)) return index > 0;
  return STREET_TYPES.test(token);
}

export function shortCamLabel(label: string): string {
  const trim = (part: string): string =>
    part
      .trim()
      .split(/\s+/)
      .filter((token, i) => token && !isStreetType(token, i))
      .join(" ");

  return label
    .replace(/\s*#\d+$/, "")
    .split("@")
    .map(trim)
    .filter(Boolean)
    .join(" @ ")
    .trim();
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** "23:00"/"07:00" windows that wrap past midnight. */
export function inTimeWindow(from: string | null, to: string | null, at = new Date()): boolean {
  if (!from || !to) return false;
  const toMins = (s: string): number | null => {
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  };
  const a = toMins(from);
  const b = toMins(to);
  if (a === null || b === null) return false;
  const cur = at.getHours() * 60 + at.getMinutes();
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}

/**
 * Chance of rain for a forecast day. Environment Canada often omits `pop`, so
 * the condition text is the fallback — "Chance of showers" carries the same
 * information a reader needs.
 */
export function rainChance(day: { pop: number | null; condition: string }): number | null {
  if (day.pop !== null && day.pop > 0) return day.pop;
  const c = day.condition.toLowerCase();
  if (!c) return null;
  if (/\b(rain|showers|drizzle|thunderstorm|flurries|snow)\b/.test(c)) {
    if (/chance|risk|possible|few/.test(c)) return 40;
    if (/periods|intermittent/.test(c)) return 70;
    return 90;
  }
  return null;
}

/** The next day that is expected to be wet, for the "rain tomorrow?" readout. */
export function nextWetDay(
  daily: { day: string; pop: number | null; condition: string }[],
): { day: string; chance: number; condition: string } | null {
  for (const d of daily) {
    const chance = rainChance(d);
    if (chance !== null && chance >= 40) {
      return { day: d.day, chance, condition: d.condition };
    }
  }
  return null;
}

export function aqiLabel(aqi: number | null): { text: string; tone: "ok" | "warn" | "bad" } {
  if (aqi === null) return { text: "--", tone: "ok" };
  if (aqi <= 50) return { text: "Good", tone: "ok" };
  if (aqi <= 100) return { text: "Moderate", tone: "warn" };
  return { text: "Poor", tone: "bad" };
}

/**
 * Minutes until precipitation starts, or null if none in the window.
 * Lives here rather than in the weather source: it is pure display logic, and
 * importing it from the source module would pull node:fs into the client bundle.
 */
export function rainStartsInMinutes(nowcast: Weather["nowcast"], now = Date.now()): number | null {
  const hit = nowcast.find((b) => b.mm > 0.05 && b.at >= now);
  if (!hit) return null;
  return Math.max(0, Math.round((hit.at - now) / 60000));
}

/**
 * The label on a TTC alert.
 *
 * A station alert lists every route that touches the station, so the chip read
 * "5,25,34,54,72,100,162,191,…" — wider than the sentence it was labelling and
 * useless at a glance. One or two routes are worth naming; beyond that the
 * mode is the useful label and the full list stays in the tooltip.
 */
export function routeChip(route: string, mode: string): string {
  const routes = route.split(",").map((r) => r.trim()).filter(Boolean);
  if (routes.length === 0) return mode.slice(0, 3).toUpperCase();
  if (routes.length <= 2) return routes.join(", ");
  return mode ? mode.slice(0, 3).toUpperCase() : `${routes.length} rts`;
}

/**
 * When an event is, as a calendar would say it at a glance: "NOW", "TODAY",
 * "TMRW", or the weekday — plus the start time ("6p", "9:30a").
 */
export function eventWhen(start: number, now = Date.now()): { day: string; time: string } {
  const d = new Date(start);
  const h = d.getHours();
  const m = d.getMinutes();
  const time = `${h % 12 === 0 ? 12 : h % 12}${m ? `:${m.toString().padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
  if (start <= now) return { day: "NOW", time };
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((start - midnight.getTime()) / 86_400_000);
  if (days === 0) return { day: "TODAY", time };
  if (days === 1) return { day: "TMRW", time };
  return { day: d.toLocaleDateString("en-CA", { weekday: "short" }).toUpperCase(), time };
}

/** "22h 35m" / "48m" — print time left. */
export function duration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return "--";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Whole days from today to a local YYYY-MM-DD date: 0 today, 1 tomorrow. */
export function daysUntil(date: string, now: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - start.getTime()) / 86_400_000);
}

/** "Today", "Tomorrow", or the weekday for a collection date. */
export function pickupDay(date: string, now: number): string {
  const n = daysUntil(date, now);
  if (n <= 0) return "Today";
  if (n === 1) return "Tomorrow";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { weekday: "short" });
}

/**
 * When the bins need a reminder: from mid-afternoon the day before (they go
 * out the night before) until late morning on the day.
 */
export function binsReminder(date: string, now: number): "tonight" | "today" | null {
  const n = daysUntil(date, now);
  const hour = new Date(now).getHours();
  if (n === 1 && hour >= 15) return "tonight";
  if (n === 0 && hour < 11) return "today";
  return null;
}

/**
 * A link as typed into a form, made safe to put in an href. The City's events
 * export carries websites like "appletreemarkets.ca" with no scheme, which a
 * browser resolves against the dashboard itself and navigates the kiosk to a
 * dead page with no way back.
 */
export function webLink(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s)) return `https://${s}`;
  return "";
}

/**
 * A TTC stop name cut to what identifies it: "O'Connor Dr At Glenwood Cres
 * West Side" becomes "O'Connor @ Glenwood W side". The full name stays in
 * the tooltip.
 */
export function shortStop(title: string): string {
  const side = /\s+(North|South|East|West)\s+Side$/i.exec(title);
  const base = side ? title.slice(0, side.index) : title;
  const short = shortCamLabel(base.replace(/\s+At\s+/i, " @ "))
    .replace(/\bEast\b/g, "E")
    .replace(/\bWest\b/g, "W")
    .replace(/\bNorth\b/g, "N")
    .replace(/\bSouth\b/g, "S");
  return side ? `${short} ${side[1][0].toUpperCase()} side` : short;
}

/**
 * Where a bus is headed, as short as it can be and still be right:
 * "Broadview Station via O'Connor" becomes "Broadview Stn". The branch
 * detail is the part a rider already knows.
 */
export function shortDestination(towards: string): string {
  return towards.replace(/\s+via\s+.*$/i, "").replace(/\bStation\b/i, "Stn").trim();
}

/** "US$1 = C$1.4154 ▼0.30%": the daily rate and its move since the day before. */
export function fxLine(fx: { rate: number; prev: number | null }): string {
  const base = `US$1 = C$${fx.rate.toFixed(4)}`;
  if (!fx.prev) return base;
  const pct = ((fx.rate - fx.prev) / fx.prev) * 100;
  if (Math.abs(pct) < 0.005) return `${base} · unchanged`;
  return `${base} ${pct > 0 ? "▲" : "▼"}${Math.abs(pct).toFixed(2)}%`;
}

/** "Christmas Day · Fri Dec 25 · in 9 days", or null when it is far off. */
export function holidayLine(h: { date: string; name: string }, now: number, withinDays = 30): string | null {
  const n = daysUntil(h.date, now);
  if (n < 0 || n > withinDays) return null;
  const [y, m, d] = h.date.split("-").map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  const when = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
  return `${h.name} · ${day} · ${when}`;
}
