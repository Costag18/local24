import { listHealth, pruneCamFrames, pruneItems, reviveDeadCams, pruneStaleHealth, purgeRetired } from "./db";
import { loadConfig } from "./config";
import { hasAudience, notifyChanged } from "./live";
import { backoffFactor } from "./http";
import { ingestNews } from "./sources/news";
import { ingestWeather } from "./sources/weather";
import { ingestTraffic } from "./sources/traffic";
import { ingestTransit } from "./sources/transit";
import { ingestFights } from "./sources/fights";
import { ingestEvents } from "./sources/events";
import { ingestCamCatalogue } from "./sources/cams";
import { ingestTtcShapes, ingestTtcVehicles } from "./sources/ttcmap";
import { ingestLiveCamStatus } from "./sources/livecams";
import { ingestStreets } from "./sources/streets";
import { ingestPickup } from "./sources/pickup";
import { ingestMarket } from "./sources/market";
import { ingestExtras } from "./sources/extras";

export interface Job {
  id: string;
  label: string;
  /** Base interval; multiplied by backoff and by the battery-saver factor. */
  interval: number;
  run: () => Promise<unknown>;
  /** Only worth running while a screen is open (it feeds nothing stored). */
  onScreenOnly?: boolean;
  /** Its data is not part of the pushed state, so finishing it changes nothing on screen. */
  quiet?: boolean;
}

const MIN = 60_000;

export const JOBS: Job[] = [
  { id: "news", label: "News", interval: 5 * MIN, run: ingestNews },
  { id: "weather", label: "Weather", interval: 10 * MIN, run: ingestWeather },
  { id: "traffic", label: "Traffic", interval: 3 * MIN, run: ingestTraffic },
  { id: "transit", label: "Transit", interval: MIN, run: ingestTransit },
  { id: "fights", label: "Fight cards", interval: 60 * MIN, run: ingestFights },
  // A 200 MB export of the whole calendar; twice a day is plenty.
  { id: "events", label: "Local events", interval: 12 * 60 * MIN, run: ingestEvents },
  // Buses report every ~12s; the shapes behind them change on service changes.
  // Positions are only ever looked at live, so they rest while no screen is
  // open rather than polling the TTC every five seconds all night.
  { id: "ttcbuses", label: "Live buses", interval: 5_000, run: ingestTtcVehicles, onScreenOnly: true, quiet: true },
  { id: "ttcshapes", label: "Route shapes", interval: 12 * 60 * MIN, run: ingestTtcShapes, quiet: true },
  // Checks every two hours, but the job skips while its stored copy is under a
  // week old — so in practice this only retries until the first copy lands.
  { id: "streets", label: "Street outlines", interval: 2 * 60 * MIN, run: ingestStreets, quiet: true },
  // A stream that ends shows a dead player until this notices; half an hour
  // keeps that window short without hammering YouTube.
  // The schedule is annual; the job only fetches when it runs low or home moves.
  { id: "pickup", label: "Garbage schedule", interval: 12 * 60 * MIN, run: ingestPickup },
  // A dozen page loads a pass, spaced out: about what a person refreshing would do.
  { id: "market", label: "Marketplace", interval: 20 * MIN, run: ingestMarket },
  // Holidays and the exchange rate change daily at most.
  { id: "extras", label: "Holidays & USD/CAD", interval: 6 * 60 * MIN, run: ingestExtras },
  { id: "livecams", label: "Live cam status", interval: 30 * MIN, run: ingestLiveCamStatus },
  { id: "cams", label: "Camera catalogue", interval: 12 * 60 * MIN, run: ingestCamCatalogue, quiet: true },
  {
    id: "camrevive",
    label: "Camera retry",
    interval: 15 * MIN,
    run: async () => reviveDeadCams(),
    quiet: true,
  },
];

interface JobState {
  lastRun: number;
  running: boolean;
}

const state = new Map<string, JobState>();
let timer: NodeJS.Timeout | null = null;
let started = false;

/** Worst consecutive-failure count among the sources a job owns. */
function failuresFor(jobId: string): number {
  return listHealth()
    .filter((h) => h.sourceId.startsWith(jobId))
    .reduce((worst, h) => Math.max(worst, h.consecutiveFailures), 0);
}

function intervalFor(job: Job, onBattery: boolean): number {
  const cfg = loadConfig();
  const override = cfg.sourceIntervalOverrides[job.id];
  const base = override && override > 0 ? override : job.interval;
  const saver = onBattery && cfg.power.batterySaver ? 2.5 : 1;
  return base * backoffFactor(failuresFor(job.id)) * saver;
}

let onBattery = false;

/** The browser reports power state; the server has no portable way to read it. */
export function setBatteryState(discharging: boolean): void {
  onBattery = discharging;
}

export function isOnBattery(): boolean {
  return onBattery;
}

async function tick(): Promise<void> {
  const now = Date.now();
  for (const job of JOBS) {
    const s = state.get(job.id) ?? { lastRun: 0, running: false };
    if (s.running) continue;
    if (now - s.lastRun < intervalFor(job, onBattery)) continue;
    if (job.onScreenOnly && !hasAudience()) continue;

    s.running = true;
    state.set(job.id, s);
    // Deliberately not awaited as a group: one slow source must not delay the rest.
    void job
      .run()
      .catch((err) => console.error(`[poller] ${job.id} failed:`, err))
      .finally(() => {
        state.set(job.id, { lastRun: Date.now(), running: false });
        // Screens get the new data now, not on their next timer.
        if (!job.quiet) notifyChanged();
      });
  }
}

/**
 * Idempotent. Next's dev server re-evaluates modules, so a second call must not
 * stack a second interval.
 */
export function startPoller(): void {
  // Clears health rows for sources that no longer run.
  try {
    pruneStaleHealth();
    purgeRetired();
  } catch {
    /* a cold database has no table yet */
  }

  if (started) return;
  started = true;
  void tick();
  // Fast enough for the 5s bus job; every other job gates on its own interval.
  timer = setInterval(() => void tick(), 5_000);
  // Keep the DB bounded on a machine that is left running. Camera frames are
  // by far the biggest consumer, so they are trimmed far more often than items.
  setInterval(() => {
    try {
      pruneCamFrames();
    } catch (err) {
      console.error("[poller] frame prune failed:", err);
    }
  }, 5 * MIN);
  setInterval(() => {
    try {
      pruneItems();
    } catch (err) {
      console.error("[poller] prune failed:", err);
    }
  }, 6 * 60 * MIN);
}

export function stopPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

/** Forces one job to run now, ignoring its interval. Used by the refresh button. */
export async function runNow(jobId: string): Promise<boolean> {
  const job = JOBS.find((j) => j.id === jobId);
  if (!job) return false;
  try {
    await job.run();
    state.set(job.id, { lastRun: Date.now(), running: false });
    if (!job.quiet) notifyChanged();
    return true;
  } catch (err) {
    console.error(`[poller] manual ${jobId} failed:`, err);
    return false;
  }
}

export function jobStatus(): { id: string; label: string; lastRun: number; running: boolean; nextInMs: number }[] {
  const now = Date.now();
  return JOBS.map((j) => {
    const s = state.get(j.id) ?? { lastRun: 0, running: false };
    return {
      id: j.id,
      label: j.label,
      lastRun: s.lastRun,
      running: s.running,
      nextInMs: Math.max(0, s.lastRun + intervalFor(j, onBattery) - now),
    };
  });
}
