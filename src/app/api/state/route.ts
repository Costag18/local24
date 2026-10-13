import { NextResponse } from "next/server";
import { buildState } from "@/lib/state";
import { startPoller } from "@/lib/poller";
import { noteAudience } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  startPoller(); // the first request in a cold process brings polling up
  // The health page asks for the diagnostics; the dashboard does not need them.
  const diag = new URL(req.url).searchParams.get("diag") === "1";
  if (!diag) noteAudience();
  return NextResponse.json(buildState(diag));
}
