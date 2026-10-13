import { getBlob, putBlob } from "@/lib/db";
import { BROWSER_UA } from "@/lib/http";
import { baseTileUrl } from "@/lib/radar";

export const dynamic = "force-dynamic";

/** Streets and coastlines barely change; a month is fine. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The radar's dark basemap, served from here.
 *
 * The radar only ever uses a dozen tiles per layer, so each is fetched once
 * and kept, and every screen on the network shares the copy instead of
 * asking Esri itself.
 */
export async function GET(req: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) {
  const p = await ctx.params;
  const [z, x, y] = [p.z, p.x, p.y.replace(/\.png$/, "")].map(Number);
  const n = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 12 || x < 0 || y < 0 || x >= n || y >= n) {
    return new Response("bad tile", { status: 400 });
  }

  const layer = new URL(req.url).searchParams.get("layer") === "ref" ? "ref" : "base";
  const key = `radar.tile.${layer}.${z}/${x}/${y}`;
  const hit = getBlob<string>(key);
  const send = (b64: string) =>
    new Response(Buffer.from(b64, "base64"), {
      // The base layer is JPEG and the labels PNG; browsers sniff either way.
      headers: { "content-type": layer === "ref" ? "image/png" : "image/jpeg", "cache-control": "public, max-age=604800" },
    });
  if (hit && Date.now() - hit.at < MAX_AGE_MS) return send(hit.value);

  try {
    const res = await fetch(baseTileUrl(layer, z, x, y), { headers: { "user-agent": BROWSER_UA }, cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    putBlob(key, b64);
    return send(b64);
  } catch {
    return hit ? send(hit.value) : new Response("tile unavailable", { status: 502 });
  }
}
