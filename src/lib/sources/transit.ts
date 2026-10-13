import { fetchJson } from "../http";
import { replaceItemsOfKind } from "../db";
import { itemId } from "../rss";
import { loadConfig } from "../config";
import { highlightPlaces } from "../places";
import type { Item } from "../types";

// The TTC's own live alerts feed — delays, closures, diversions and planned
// work. Keyless. Verified 2026-09-09.
const TTC_ALERTS = "https://alerts.ttc.ca/api/alerts/live-alerts";

export { highlightPlaces, type TextPart } from "../places";

export interface RawAlert {
  id?: string;
  route?: string;
  routeType?: string;
  alertType?: string;
  title?: string;
  description?: string;
  effect?: string;
  severity?: string;
  severityOrder?: number;
  activePeriodGroup?: string[];
  lastUpdated?: string;
  url?: string;
}

interface AlertsResp {
  routes?: RawAlert[];
  accessibility?: RawAlert[];
  siteWide?: RawAlert[];
  lastUpdated?: string;
}

export interface TransitAlert {
  id: string;
  route: string;
  mode: string;
  planned: boolean;
  current: boolean;
  title: string;
  /** True when the alert names one of the places you travel through. */
  local: boolean;
  weight: number;
  updated: number;
}

/** Subway disruption beats a bus one; unplanned beats planned; current beats future. */
export function alertWeight(a: RawAlert, places: string[] = []): number {
  const mode = (a.routeType ?? "").toLowerCase();
  const modeScore = mode.includes("subway") ? 3 : mode.includes("streetcar") ? 2 : 1;
  const unplanned = (a.alertType ?? "").toLowerCase() !== "planned" ? 4 : 0;
  const current = (a.activePeriodGroup ?? []).includes("Current") ? 2 : 0;
  // An alert naming somewhere you travel outranks one that does not.
  const local = places.length && highlightPlaces(a.title ?? "", places).some((p) => p.hit) ? 6 : 0;
  return modeScore + unplanned + current + local;
}

export function parseAlerts(resp: AlertsResp, places: string[] = []): TransitAlert[] {
  const groups = [resp.siteWide ?? [], resp.routes ?? [], resp.accessibility ?? []];
  const seen = new Set<string>();
  const out: TransitAlert[] = [];

  for (const group of groups) {
    for (const a of group) {
      const title = (a.title ?? a.description ?? "").trim();
      if (!title) continue;
      // The feed repeats a disruption once per affected branch.
      const key = `${a.route ?? ""}|${title}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const updated = a.lastUpdated ? Date.parse(a.lastUpdated) : NaN;
      out.push({
        id: String(a.id ?? key),
        route: (a.route ?? "").trim(),
        mode: (a.routeType ?? "").trim(),
        planned: (a.alertType ?? "").toLowerCase() === "planned",
        current: (a.activePeriodGroup ?? []).includes("Current"),
        title,
        local: places.length > 0 && highlightPlaces(title, places).some((part) => part.hit),
        weight: alertWeight(a, places),
        updated: Number.isFinite(updated) ? updated : Date.now(),
      });
    }
  }

  return out.sort((a, b) => b.weight - a.weight || b.updated - a.updated);
}

export async function ingestTransit(): Promise<number> {
  const resp = await fetchJson<AlertsResp>("transit.ttc", TTC_ALERTS, 25000);
  if (!resp) return 0;

  const now = Date.now();
  const alerts = parseAlerts(resp, loadConfig().transitPlaces).slice(0, 25);

  const items: Item[] = alerts.map((a) => ({
    id: itemId("transit.ttc", `alert-${a.id}`, a.title),
    kind: "transit" as const,
    sourceId: "transit.ttc",
    title: a.title,
    body: "",
    link: "https://www.ttc.ca/service-alerts",
    published: a.updated,
    fetched: now,
    weight: a.weight,
    // Flagged when the alert names somewhere on the transitPlaces list.
    meta: { route: a.route, mode: a.mode, planned: a.planned, current: a.current, local: a.local },
  }));

  // Alerts are cleared as soon as service resumes, so a resolved closure must
  // disappear rather than linger from an earlier fetch.
  return replaceItemsOfKind("transit", items);
}
