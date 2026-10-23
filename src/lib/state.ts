import { readFileSync } from "node:fs";
import path from "node:path";
import { getBlob, listHealth, listItems } from "./db";
import { freshenCards } from "./sources/fights";
import { upcomingEvents } from "./sources/events";
import { getPickups } from "./sources/pickup";
import { getListings } from "./sources/market";
import { getFx, getHolidays, type Fx, type Holiday } from "./sources/extras";
import { getSellers, type SellerItem } from "./sources/ebay";
import { getIdeas, type TrendingModel, type TrendingSearch } from "./sources/ideas";
import { localDate } from "./sources/pickup";
import { loadConfig, publicConfig } from "./config";
import { jobStatus } from "./poller";
import { getLiveCamStatus, type CamStatus } from "./sources/livecams";
import type { AppConfig, FightCard, Item, Listing, LocalEvent, Pickup, SourceHealth, TrafficEvent, Weather } from "./types";

export interface Stamped<T> {
  data: T;
  at: number;
}

export interface AppState {
  now: number;
  /** Which build the server is running; a screen reloads when it changes. */
  build: string;
  config: AppConfig;
  weather: Stamped<Weather> | null;
  traffic: Stamped<TrafficEvent[]>;
  breaking: TrafficEvent[];
  transit: Item[];
  fights: Stamped<FightCard[]>;
  tech: Item[];
  local: Item[];
  crime: Item[];
  /** Each at its next date, soonest first — recomputed against the clock. */
  events: LocalEvent[];
  camStatus: CamStatus[];
  /** The next two garbage collections at home, and the calendar they come from. */
  pickup: { calendar: string; next: Pickup[] };
  /** Newest local listings across the marketplaces, newest first. */
  market: Listing[];
  /** Today's and the next Ontario holidays. */
  holidays: Holiday[];
  /** US dollar in Canadian dollars, daily. */
  fx: Fx | null;
  /** 3D-printed listings selling on eBay; `tracking` once a day of readings exists. */
  sellers: { items: Omit<SellerItem, "history">[]; tracking: boolean };
  /** This week's trending models and today's trending searches. */
  ideas: { models: TrendingModel[]; trends: TrendingSearch[] };
  /** 3D printing industry news. */
  print3d: Item[];
  /** People asking for something to be printed (Reddit). */
  leads: Item[];
  /** Diagnostics, only built for the health page — see `buildState`. */
  health: SourceHealth[];
  jobs: ReturnType<typeof jobStatus>;
}

/** Read once: a running server never changes build. */
let buildId: string | null = null;
function currentBuild(): string {
  if (buildId === null) {
    try {
      buildId = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    } catch {
      buildId = "dev";
    }
  }
  return buildId;
}

/**
 * The single payload the dashboard renders from. Every section carries the
 * timestamp of the data behind it so a tile can show "3m ago" rather than
 * blanking when its source is failing.
 */
export function buildState(diagnostics = false): AppState {
  const weather = getBlob<Weather>("weather");
  const traffic = getBlob<TrafficEvent[]>("traffic");
  const breaking = getBlob<TrafficEvent[]>("traffic.breaking");
  const fights = getBlob<FightCard[]>("fights");

  return {
    now: Date.now(),
    build: currentBuild(),
    config: publicConfig(loadConfig()),
    weather: weather ? { data: weather.value, at: weather.at } : null,
    // Already sorted most-severe first. The panel and the ticker show about
    // fourteen between them; the other thirty rode along in every push.
    traffic: traffic ? { data: traffic.value.slice(0, 30), at: traffic.at } : { data: [], at: 0 },
    breaking: breaking?.value ?? [],
    // Re-evaluated against the clock on every build: the scrape is hourly, so
    // an event finishing must not wait for the next one to leave the panel.
    fights: fights ? { data: freshenCards(fights.value), at: fights.at } : { data: [], at: 0 },
    // Everything decays with age, so an old story cannot pin the top.
    tech: listItems(["tech"], 30, true),
    local: listItems(["local"], 25, true),
    crime: listItems(["crime"], 20, true),
    transit: listItems(["transit"], 25, true),
    events: upcomingEvents(getBlob<{ events: LocalEvent[] }>("events")?.value.events ?? []),
    camStatus: getLiveCamStatus(),
    pickup: getPickups(),
    market: getListings(),
    holidays: getHolidays(localDate(Date.now())),
    fx: getFx(),
    sellers: (() => {
      const s = getSellers(40);
      // The day-to-day readings stay on the server; the screen needs the result.
      return { tracking: s.tracking, items: s.items.map(({ history: _h, ...rest }) => rest) };
    })(),
    ideas: getIdeas(),
    print3d: listItems(["print3d"], 25, true),
    // Only Canadian requests (older rows from before that rule are skipped too).
    leads: listItems(["lead"], 40, true).filter((it) => it.meta?.place && it.meta.place !== "elsewhere"),
    // 9KB of per-source history that only the health page reads. It rode along
    // in every dashboard payload, ten seconds apart, for nothing.
    health: diagnostics ? listHealth() : [],
    jobs: diagnostics ? jobStatus() : [],
  };
}
