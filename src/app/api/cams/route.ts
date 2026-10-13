import { NextResponse } from "next/server";
import { listCams } from "@/lib/db";
import { camsNearby } from "@/lib/sources/cams";
import { loadConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cfg = loadConfig();

  if (url.searchParams.get("near") === "1") {
    const radius = Number(url.searchParams.get("radiusKm") ?? cfg.camRadiusKm);
    return NextResponse.json({
      cams: camsNearby(cfg.place.lat, cfg.place.lon, Number.isFinite(radius) ? radius : 8),
    });
  }

  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const all = listCams();
  const cams = q
    ? all.filter((c) => `${c.label} ${c.roadway} ${c.cross}`.toLowerCase().includes(q))
    : all;
  return NextResponse.json({ cams, total: all.length });
}
