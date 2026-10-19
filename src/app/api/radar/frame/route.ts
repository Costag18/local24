import { loadConfig } from "@/lib/config";
import { BROWSER_UA } from "@/lib/http";
import { RADAR_LAYERS, radarFrameUrl, radarGrid } from "@/lib/radar";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __local24RadarPng?: Map<string, Buffer> };
const cache = (g.__local24RadarPng ??= new Map());

/**
 * One radar frame as a picture, served from here over plain http.
 *
 * The TV page needs this: a PlayStation 3's browser cannot negotiate the
 * HTTPS that Environment Canada requires, but it can load an image from the
 * dashboard on the home network. Frames never change once published, so each
 * is fetched once and kept (the newest few only).
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const layer = q.get("layer") ?? "";
  const time = q.get("time") ?? "";
  if (!(RADAR_LAYERS as readonly string[]).includes(layer) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/.test(time)) {
    return new Response("bad frame", { status: 400 });
  }
  const key = `${layer}|${time}`;
  let png = cache.get(key);
  if (!png) {
    const home = loadConfig().home;
    try {
      const res = await fetch(radarFrameUrl(layer, time, radarGrid(home.lat, home.lon)), {
        headers: { "user-agent": BROWSER_UA },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return new Response("frame unavailable", { status: 502 });
      png = Buffer.from(await res.arrayBuffer());
    } catch {
      return new Response("frame unavailable", { status: 502 });
    }
    cache.set(key, png);
    while (cache.size > 8) cache.delete(cache.keys().next().value as string);
  }
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
}
