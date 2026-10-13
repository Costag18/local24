import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { stopBridge } from "@/lib/nest/bridge";

export const dynamic = "force-dynamic";

const PID_FILE = path.resolve(process.cwd(), "data/kiosk.pid");

/** Ends a process tree without waiting around for it. */
function kill(pid: number) {
  try {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }).unref();
  } catch {
    /* already gone */
  }
}

/**
 * Shuts the whole thing down: the kiosk window, the camera bridge, the server.
 *
 * Closing the kiosk by hand left the server running and the bridge's browser
 * with it, so the next launch stacked another window on top. One button ends
 * all three.
 */
export async function POST() {
  // The bridge's own browser first — it is a separate process from the kiosk.
  await stopBridge().catch(() => undefined);

  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0) kill(pid);
    try {
      unlinkSync(PID_FILE);
    } catch {
      /* best effort */
    }
  }

  // Answer before going away, or the page sees a failed request instead of a
  // clean goodbye.
  setTimeout(() => process.exit(0), 400);
  return NextResponse.json({ ok: true });
}
