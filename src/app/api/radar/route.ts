import { NextResponse } from "next/server";
import { fetchText } from "@/lib/http";
import { loadConfig } from "@/lib/config";
import { RADAR_LAYERS, frameTimes } from "@/lib/radar";

export const dynamic = "force-dynamic";

/** GeoMet adds a frame every six minutes; checking every two is plenty. */
const TTL_MS = 2 * 60_000;

const g = globalThis as unknown as { __local24Radar?: { at: number; frames: string[] } };

/**
 * Which radar frames exist right now, plus the point to centre on.
 *
 * The browser loads the images straight from Environment Canada; all it needs
 * from here is the list of times, which lives in a WMS capabilities document
 * the browser cannot read cross-origin. Cached so every screen shares one ask.
 */
export async function GET() {
  const home = loadConfig().home;
  const hit = g.__local24Radar;
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ ...hit, layers: RADAR_LAYERS, home });

  const xml = await fetchText(
    "radar.geomet",
    `https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities&LAYERS=${RADAR_LAYERS[0]}`,
    12_000,
  );
  const dim = xml ? /<Dimension name="time"[^>]*>([^<]+)</.exec(xml)?.[1] : null;
  const frames = dim ? frameTimes(dim, 15) : [];
  if (frames.length) g.__local24Radar = { at: Date.now(), frames };
  const out = frames.length ? frames : (hit?.frames ?? []);
  return NextResponse.json({ at: Date.now(), frames: out, layers: RADAR_LAYERS, home });
}
