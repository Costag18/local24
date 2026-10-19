import { fetchText } from "./http";
import { RADAR_LAYERS, frameTimes } from "./radar";

/** GeoMet adds a frame every six minutes; checking every two is plenty. */
const TTL_MS = 2 * 60_000;

const g = globalThis as unknown as { __local24Radar?: { at: number; frames: string[] } };

/**
 * Which radar frames exist right now. The list lives in a WMS capabilities
 * document a browser cannot read cross-origin, so the server reads it — once
 * every couple of minutes, shared by every screen (and the TV page).
 */
export async function radarFrames(): Promise<string[]> {
  const hit = g.__local24Radar;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.frames;
  const xml = await fetchText(
    "radar.geomet",
    `https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities&LAYERS=${RADAR_LAYERS[0]}`,
    12_000,
  );
  const dim = xml ? /<Dimension name="time"[^>]*>([^<]+)</.exec(xml)?.[1] : null;
  const frames = dim ? frameTimes(dim, 15) : [];
  if (frames.length) g.__local24Radar = { at: Date.now(), frames };
  return frames.length ? frames : (hit?.frames ?? []);
}
