import { getBlob, putBlob } from "../db";
import { fetchJson } from "../http";

/**
 * Two small facts that change rarely and are worth a glance.
 *
 *   - Ontario statutory holidays (date.nager.at, keyless). A holiday changes
 *     the TTC to Sunday service, closes most stores and shifts garbage day, so
 *     the top bar mentions one a few days ahead.
 *   - The US dollar in Canadian dollars (Bank of Canada Valet, keyless): the
 *     daily average rate, which is what filament and parts bought from US
 *     shops actually cost.
 */

export interface Holiday {
  /** Local date, YYYY-MM-DD. */
  date: string;
  name: string;
}

export interface Fx {
  /** CAD per USD. */
  rate: number;
  /** The previous business day's rate, for the arrow. */
  prev: number | null;
  /** The day the rate is for, YYYY-MM-DD. */
  date: string;
}

interface NagerHoliday {
  date?: string;
  name?: string;
  localName?: string;
  global?: boolean;
  counties?: string[] | null;
}

/** Holidays observed in Ontario: national ones plus those listing CA-ON. */
export function ontarioHolidays(list: NagerHoliday[]): Holiday[] {
  const seen = new Set<string>();
  const out: Holiday[] = [];
  for (const h of list) {
    if (!h.date || !h.name) continue;
    if (!h.global && !(h.counties ?? []).includes("CA-ON")) continue;
    if (seen.has(h.date)) continue;
    seen.add(h.date);
    out.push({ date: h.date, name: h.name });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The newest two observations from a Valet series response. */
export function parseFx(json: unknown): Fx | null {
  const obs = (json as { observations?: { d?: string; FXUSDCAD?: { v?: string } }[] })?.observations ?? [];
  const rows = obs
    .map((o) => ({ date: o.d ?? "", rate: Number(o.FXUSDCAD?.v) }))
    .filter((o) => o.date && Number.isFinite(o.rate) && o.rate > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length) return null;
  return { rate: rows[0].rate, prev: rows[1]?.rate ?? null, date: rows[0].date };
}

export async function ingestExtras(): Promise<number> {
  const year = new Date().getFullYear();
  const [a, b, fx] = await Promise.all([
    fetchJson<NagerHoliday[]>("extras.holidays", `https://date.nager.at/api/v3/PublicHolidays/${year}/CA`),
    fetchJson<NagerHoliday[]>("extras.holidays", `https://date.nager.at/api/v3/PublicHolidays/${year + 1}/CA`),
    fetchJson<unknown>("extras.fx", "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=5"),
  ]);
  const holidays = ontarioHolidays([...(a ?? []), ...(b ?? [])]);
  if (holidays.length) putBlob("holidays", holidays);
  const rate = fx ? parseFx(fx) : null;
  if (rate) putBlob("fx", rate);
  return holidays.length + (rate ? 1 : 0);
}

/** Today's and upcoming holidays, soonest first. */
export function getHolidays(today: string, count = 3): Holiday[] {
  return (getBlob<Holiday[]>("holidays")?.value ?? []).filter((h) => h.date >= today).slice(0, count);
}

export function getFx(): Fx | null {
  return getBlob<Fx>("fx")?.value ?? null;
}
