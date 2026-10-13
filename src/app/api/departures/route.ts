import { NextResponse } from "next/server";
import { fetchJson } from "@/lib/http";
import { loadConfig } from "@/lib/config";
import { parsePredictions, type Departure } from "@/lib/sources/departures";

export const dynamic = "force-dynamic";

/** NextBus refreshes about every 20 seconds; asking faster gains nothing. */
const TTL_MS = 20_000;

const g = globalThis as unknown as { __local24Departures?: Map<string, { at: number; data: Departure[] }> };
const cache = (g.__local24Departures ??= new Map());

/**
 * Arrivals for each stop configured under `map.departures`, for the strip
 * under the map. Cached briefly so several screens on the network share one
 * request to the TTC.
 */
export async function GET() {
  const stops = loadConfig().map.departures ?? [];
  const results = await Promise.all(
    stops.map(async (s) => {
      const key = `${s.route}:${s.stop}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < TTL_MS) return { ...s, times: hit.data };
      const json = await fetchJson<unknown>(
        "ttc.predictions",
        `https://retro.umoiq.com/service/publicJSONFeed?command=predictions&a=ttc&r=${encodeURIComponent(s.route)}&s=${encodeURIComponent(s.stop)}`,
        10_000,
      );
      const data = json ? parsePredictions(json, s.direction ?? "") : (hit?.data ?? []);
      cache.set(key, { at: Date.now(), data });
      return { ...s, times: data };
    }),
  );
  return NextResponse.json({ stops: results, at: Date.now() });
}
