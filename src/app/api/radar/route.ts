import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { RADAR_LAYERS } from "@/lib/radar";
import { radarFrames } from "@/lib/radarFrames";

export const dynamic = "force-dynamic";

/**
 * Which radar frames exist right now, plus the point to centre on. The
 * dashboard loads the images straight from Environment Canada; see
 * lib/radarFrames.ts for where the list comes from.
 */
export async function GET() {
  const frames = await radarFrames();
  return NextResponse.json({ at: Date.now(), frames, layers: RADAR_LAYERS, home: loadConfig().home });
}
