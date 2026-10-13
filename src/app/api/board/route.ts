import { NextResponse } from "next/server";
import { getBlob } from "@/lib/db";
import { fetchJson } from "@/lib/http";
import { loadConfig } from "@/lib/config";
import { parsePredictions, type Departure } from "@/lib/sources/departures";
import type { BoardStop } from "@/lib/sources/ttcmap";

export const dynamic = "force-dynamic";

const TTL_MS = 20_000;

export interface BoardRow extends BoardStop {
  times: Departure[];
}

const g = globalThis as unknown as { __local24Board?: { at: number; rows: BoardRow[] } };

/**
 * The next buses on every followed route, both ways, at the stop nearest
 * home — one request to the TTC for all of them, shared by every screen.
 */
export async function GET() {
  const hit = g.__local24Board;
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit);

  const follow = new Set(loadConfig().map.routes);
  const stops = (getBlob<BoardStop[]>("ttc.board")?.value ?? []).filter((s) => !follow.size || follow.has(s.route));
  if (!stops.length) return NextResponse.json({ at: Date.now(), rows: [] });

  const q = stops.map((s) => `stops=${encodeURIComponent(`${s.route}|${s.stop}`)}`).join("&");
  const json = await fetchJson<{ predictions?: unknown }>(
    "ttc.board",
    `https://retro.umoiq.com/service/publicJSONFeed?a=ttc&command=predictionsForMultiStops&${q}`,
    10_000,
  );
  const blocks = json?.predictions ? ([] as { routeTag?: string; stopTag?: string }[]).concat(json.predictions as never) : [];
  const rows: BoardRow[] = stops.map((s) => {
    const mine = blocks.filter((b) => b.routeTag === s.route && b.stopTag === s.stop);
    const times = mine.flatMap((b) => parsePredictions({ predictions: b }, s.dir)).sort((a, b) => a.at - b.at);
    const old = hit?.rows.find((r) => r.route === s.route && r.stop === s.stop);
    return { ...s, times: json ? times : (old?.times ?? []) };
  });

  g.__local24Board = { at: Date.now(), rows };
  return NextResponse.json(g.__local24Board);
}
