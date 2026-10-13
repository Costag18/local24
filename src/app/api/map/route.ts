import { NextResponse } from "next/server";
import { getBlob, listCams } from "@/lib/db";
import { loadConfig } from "@/lib/config";
import { getShapes, getVehicles, withinBounds } from "@/lib/sources/ttcmap";
import { getStreets, streetsVersion } from "@/lib/sources/streets";
import { startPoller } from "@/lib/poller";
import { noteAudience } from "@/lib/live";
import type { TrafficEvent } from "@/lib/types";

/** Changes only when the geometry is re-fetched, which is twice a day. */
function staticVersion(): number {
  const shapes = getBlob<unknown>("ttc.shapes")?.at ?? 0;
  return Math.max(shapes, streetsVersion());
}

export const dynamic = "force-dynamic";

/**
 * Everything the local map draws.
 *
 * The geometry — route shapes and the subway — is 330KB and changes twice a
 * day; the vehicles are 15KB and change every five seconds. Sending both on
 * every poll cost about four megabytes a minute, so `?only=live` returns just
 * the moving parts, and `staticVersion` tells the client when the geometry
 * underneath it has actually changed.
 */
export async function GET(req: Request) {
  startPoller();
  // A screen showing the map keeps the five-second bus poll awake.
  noteAudience();

  const liveOnly = new URL(req.url).searchParams.get("only") === "live";
  const cfg = loadConfig();
  const bounds = cfg.map.bounds;
  const vehicles = getVehicles();

  const cameras = cfg.map.showCameras
    ? listCams()
        .filter((c) => (c.lat !== 0 || c.lon !== 0) && withinBounds(c, bounds))
        .map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, label: c.label, dead: c.dead }))
    : [];

  const incidents = cfg.map.showIncidents
    ? (getBlob<TrafficEvent[]>("traffic")?.value ?? [])
        .filter((e) => (e.lat !== 0 || e.lon !== 0) && withinBounds(e, bounds))
        .map((e) => ({
          id: e.id,
          lat: e.lat,
          lon: e.lon,
          roadway: e.roadway,
          description: e.description,
          fullClosure: e.isFullClosure,
        }))
    : [];

  const live = {
    vehicles: vehicles.data,
    vehiclesAt: vehicles.at,
    cameras,
    incidents,
    staticVersion: staticVersion(),
  };

  if (liveOnly) return NextResponse.json(live);

  return NextResponse.json({
    label: cfg.map.label,
    bounds,
    view: cfg.map.view,
    showStops: cfg.map.showStops,
    shapes: getShapes(),
    streets: getStreets(),
    ...live,
  });
}
