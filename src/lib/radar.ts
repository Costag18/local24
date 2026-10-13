/**
 * Weather radar geometry and frame times. Pure, so the browser can use it.
 *
 * The picture is Environment Canada's composite radar (GeoMet WMS, keyless,
 * a new frame every six minutes for the last three hours) laid over a dark
 * basemap. Both are drawn in web-mercator tiles at one zoom, so the
 * radar image is requested for exactly the box the tiles cover and the two
 * line up without any reprojection in the browser.
 */

export const RADAR_ZOOM = 8;
/** Rain and snow are separate layers; GeoMet will not combine them in one request. */
export const RADAR_LAYERS = ["RADAR_1KM_RRAI", "RADAR_1KM_RSNO"] as const;
const HALF = 20037508.342789244;
const TILE = 256;

/** Fractional tile position of a point at a zoom. */
export function tileOf(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

export interface RadarGrid {
  z: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** Size of the whole mosaic in pixels. */
  width: number;
  height: number;
  /** The mosaic's extent in EPSG:3857 metres: minX, minY, maxX, maxY. */
  bbox: [number, number, number, number];
  /** Where a point falls on the mosaic, in pixels. */
  px: (lat: number, lon: number) => [number, number];
}

/** A block of tiles around a point: about 450 x 340 km at the default size. */
export function radarGrid(lat: number, lon: number, cols = 4, rows = 3, z = RADAR_ZOOM): RadarGrid {
  const c = tileOf(lat, lon, z);
  const x0 = Math.round(c.x - cols / 2);
  const y0 = Math.round(c.y - rows / 2);
  const size = (2 * HALF) / 2 ** z;
  const minX = -HALF + x0 * size;
  const maxY = HALF - y0 * size;
  return {
    z, x0, y0, cols, rows,
    width: cols * TILE,
    height: rows * TILE,
    bbox: [minX, maxY - rows * size, minX + cols * size, maxY],
    px: (la, lo) => {
      const t = tileOf(la, lo, z);
      return [(t.x - x0) * TILE, (t.y - y0) * TILE];
    },
  };
}

/**
 * Esri's dark grey canvas: keyless, and split into a base (land, water,
 * roads) and a reference layer (place names) so the names can sit on top of
 * the radar. CARTO's dark tiles were the first choice but now want a key.
 */
export function baseTileUrl(layer: "base" | "ref", z: number, x: number, y: number): string {
  const name = layer === "base" ? "World_Dark_Gray_Base" : "World_Dark_Gray_Reference";
  return `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/${z}/${y}/${x}`;
}

export function radarFrameUrl(layer: string, time: string, g: RadarGrid): string {
  const q = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap",
    LAYERS: layer, STYLES: "", CRS: "EPSG:3857",
    BBOX: g.bbox.map((v) => v.toFixed(0)).join(","),
    WIDTH: String(g.width), HEIGHT: String(g.height),
    FORMAT: "image/png", TRANSPARENT: "TRUE", TIME: time,
  });
  return `https://geo.weather.gc.ca/geomet?${q}`;
}

/**
 * The newest `count` frame times from a WMS time dimension such as
 * "2026-10-13T00:54:00Z/2026-10-13T03:54:00Z/PT6M".
 */
export function frameTimes(dimension: string, count = 15): string[] {
  const [start, end, period] = dimension.trim().split("/");
  const step = /^PT(\d+)M$/.exec(period ?? "")?.[1];
  const a = Date.parse(start ?? "");
  const b = Date.parse(end ?? "");
  if (!step || !Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const ms = Number(step) * 60_000;
  const out: string[] = [];
  for (let t = b; t >= a && out.length < count; t -= ms) {
    out.unshift(new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));
  }
  return out;
}
