import { createHash } from "node:crypto";
import { fetchBinary, fetchJson } from "../http";
import { getDb, listCams, markCam, upsertCams } from "../db";
import { loadConfig } from "../config";
import type { Camera } from "../types";

const TO_ARCGIS =
  "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial2/FeatureServer/3/query" +
  "?where=1%3D1&outFields=SOURCE,IMAGEURL,MAINROAD,CROSSROAD&f=json&returnGeometry=true&outSR=4326&resultRecordCount=2000";

/** Unused since 511 started demanding a key; kept for the day it reopens. */
const ON511_CAMS = "https://511on.ca/api/v2/get/cameras";

interface ArcGisResp {
  features?: {
    attributes: Record<string, unknown>;
    geometry?: { x?: number; y?: number };
  }[];
}

/**
 * One intersection often carries several cameras pointing different ways, and
 * they all share a MAINROAD/CROSSROAD pair. Identical captions on a camera wall
 * are useless, so colliding labels get the camera number appended.
 */
export function disambiguate(cams: Camera[]): Camera[] {
  const counts = new Map<string, number>();
  for (const c of cams) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  return cams.map((c) =>
    (counts.get(c.label) ?? 0) > 1
      ? { ...c, label: `${c.label} #${c.id.split(":")[1] ?? ""}` }
      : c,
  );
}

export function parseTorontoCams(resp: ArcGisResp): Camera[] {
  const out: Camera[] = [];
  for (const f of resp.features ?? []) {
    const a = f.attributes ?? {};
    const url = String(a.IMAGEURL ?? "");
    if (!url) continue;
    // The camera number in locNNNN.jpg is the stable identity, not OBJECTID,
    // which shifts when the layer is republished.
    const num = url.match(/loc(\d+)\.jpg/i)?.[1];
    if (!num) continue;
    const main = String(a.MAINROAD ?? "").trim();
    const cross = String(a.CROSSROAD ?? "").trim();
    out.push({
      id: `to:${num}`,
      network: "toronto",
      label: cross ? `${main} @ ${cross}` : main || `Camera ${num}`,
      roadway: main,
      cross,
      lat: Number(f.geometry?.y ?? 0),
      lon: Number(f.geometry?.x ?? 0),
      imageUrl: url.replace(/^http:/, "https:"),
      dead: false,
      lastFrameHash: null,
      lastOk: null,
    });
  }
  return disambiguate(out);
}

interface On511Cam {
  Id: number;
  Roadway?: string;
  Direction?: string;
  Location?: string;
  Latitude?: number;
  Longitude?: number;
  Views?: { Id: number; Url: string; Status: string; Description?: string }[];
}

export function parseOn511Cams(rows: On511Cam[]): Camera[] {
  const out: Camera[] = [];
  for (const c of rows ?? []) {
    for (const v of c.Views ?? []) {
      if (v.Status !== "Enabled" || !v.Url) continue;
      const desc = v.Description ? ` (${v.Description})` : "";
      out.push({
        id: `on511:${v.Id}`,
        network: "ontario511",
        label: `${c.Location ?? c.Roadway ?? "Camera"}${desc}`,
        roadway: c.Roadway ?? "",
        cross: c.Direction ?? "",
        lat: Number(c.Latitude ?? 0),
        lon: Number(c.Longitude ?? 0),
        imageUrl: v.Url.replace(/^http:/, "https:"),
        dead: false,
        lastFrameHash: null,
        lastOk: null,
      });
    }
  }
  return disambiguate(out);
}

/**
 * Catalogues change rarely; this runs on a long interval.
 *
 * Ontario 511 closed its camera list in September 2026 — `/api/v2/get/cameras`
 * now answers `Invalid Key` to everyone, and the keyless list endpoint behind
 * their own map returns no rows. The *images* still load, so the 511 cameras
 * already in the database keep working; only discovering new ones is gone.
 * The request is left out rather than retried forever, which was logging a
 * failure every cycle and showing a permanently red source on the health page.
 */
export async function ingestCamCatalogue(): Promise<number> {
  const to = await fetchJson<ArcGisResp>("cams.toronto", TO_ARCGIS, 30000);
  const cams = (to ? parseTorontoCams(to) : []).filter(
    (c) => Number.isFinite(c.lat) && Number.isFinite(c.lon),
  );
  upsertCams(cams);
  return cams.length;
}

// --- frames ----------------------------------------------------------------

export function hashFrame(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex").slice(0, 16);
}

/**
 * Fetches one frame, records it in the ring buffer, and updates liveness.
 * A failed or truncated response flags the camera dead so rotation skips it
 * (the camera-retry job clears that flag later). An identical hash means the
 * feed is frozen: the frame is still shown, but it is not re-stored, so a
 * frozen camera cannot fill the rewind buffer with duplicates.
 */
type Captured = { buf: Buffer | null; dead: boolean; frozen: boolean; at: number };

/** A frame fetched this recently is handed out again instead of re-fetched. */
const SHARE_MS = 4000;
const g = globalThis as unknown as { __local24Captures?: Map<string, { at: number; result: Promise<Captured> }> };
const captures = (g.__local24Captures ??= new Map());

/**
 * One fetch per camera every few seconds, however many screens ask.
 *
 * Every open screen polls the hero camera, and each poll used to fetch the
 * source, hash it and write the result — so two screens doubled the load on
 * the City's camera server for the same picture. Concurrent requests share
 * the same in-flight fetch too.
 */
export function captureFrame(cam: Camera): Promise<Captured> {
  const now = Date.now();
  const hit = captures.get(cam.id);
  if (hit && now - hit.at < SHARE_MS) return hit.result;
  const result = captureFrameNow(cam);
  captures.set(cam.id, { at: now, result });
  // Keep the map from growing with every camera ever shown.
  if (captures.size > 64) {
    for (const [id, c] of captures) if (now - c.at > SHARE_MS) captures.delete(id);
  }
  return result;
}

async function captureFrameNow(cam: Camera): Promise<Captured> {
  const cfg = loadConfig();
  const bust = `${cam.imageUrl}${cam.imageUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const buf = await fetchBinary(`cam.${cam.id}`, bust);

  if (!buf || buf.byteLength < 1000) {
    markCam(cam.id, true, cam.lastFrameHash);
    return { buf: null, dead: true, frozen: false, at: 0 };
  }

  const hash = hashFrame(buf);
  const frozen = hash === cam.lastFrameHash;
  markCam(cam.id, false, hash);

  if (!frozen) {
    const at = Date.now();
    storeFrame(cam.id, hash, buf, cfg.camFrameBuffer);
    return { buf, dead: false, frozen, at };
  }
  // Unchanged: report when this picture was actually taken, not now.
  return { buf, dead: false, frozen, at: newestFrameAt(cam.id) ?? Date.now() };
}

export function storeFrame(camId: string, hash: string, buf: Buffer, keep: number): void {
  const d = getDb();
  d.prepare("INSERT OR REPLACE INTO cam_frames(camId,at,hash,bytes) VALUES(?,?,?,?)")
    .run(camId, Date.now(), hash, buf);
  // Trim the ring buffer to the newest `keep` frames for this camera.
  d.prepare(`
    DELETE FROM cam_frames
    WHERE camId = ?
      AND at NOT IN (SELECT at FROM cam_frames WHERE camId = ? ORDER BY at DESC LIMIT ?)
  `).run(camId, camId, keep);
}

/** Timestamp of the newest stored frame, used to report a picture's true age. */
export function newestFrameAt(camId: string): number | null {
  const row = getDb()
    .prepare("SELECT at FROM cam_frames WHERE camId = ? ORDER BY at DESC LIMIT 1")
    .get(camId) as { at: number } | undefined;
  return row ? row.at : null;
}

/** How often each network actually publishes a new frame. */
export const NETWORK_REFRESH_MS: Record<Camera["network"], number> = {
  // Measured 2026-09-09: Last-Modified held for 90s+ and Cache-Control is 60s.
  toronto: 60_000,
  // Regenerated per request, Cache-Control max-age=20.
  ontario511: 20_000,
};

export function listFrameTimes(camId: string): number[] {
  const rows = getDb()
    .prepare("SELECT at FROM cam_frames WHERE camId = ? ORDER BY at DESC")
    .all(camId) as { at: number }[];
  return rows.map((r) => r.at);
}

export function getFrame(camId: string, at?: number): Buffer | null {
  const d = getDb();
  const row = (at
    ? d.prepare("SELECT bytes FROM cam_frames WHERE camId = ? AND at = ?").get(camId, at)
    : d.prepare("SELECT bytes FROM cam_frames WHERE camId = ? ORDER BY at DESC LIMIT 1").get(camId)) as
    | { bytes: Uint8Array }
    | undefined;
  return row ? Buffer.from(row.bytes) : null;
}

// --- selection -------------------------------------------------------------

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Backs the "cams near me" suggestion in the playlist editor. */
export function camsNearby(lat: number, lon: number, radiusKm: number, limit = 24): Camera[] {
  return listCams()
    .filter((c) => c.lat !== 0 || c.lon !== 0)
    .map((c) => ({ cam: c, d: distanceKm(lat, lon, c.lat, c.lon) }))
    .filter((x) => x.d <= radiusKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.cam);
}
