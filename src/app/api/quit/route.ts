import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { stopBridge } from "@/lib/nest/bridge";
import { stop as stopMirror } from "@/lib/mirror";

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
 * Closes every Chrome running on the kiosk's own profile.
 *
 * The saved pid alone was not enough: clicking the shortcut while the kiosk
 * was open added a second window to the same browser, and the pid on file
 * belonged to a launcher process that had already handed off and exited — so
 * quitting closed only the top window and left the first one showing. Matching
 * the profile folder on the command line finds the browser however it started,
 * and leaves everyday Chrome alone.
 */
function killKioskBrowser() {
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*kiosk-profile*' -and $_.CommandLine -notlike '*--type=*' } | " +
    "ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }";
  try {
    spawn("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore", windowsHide: true, detached: true }).unref();
  } catch {
    /* the pid file below is the fallback */
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
  // And the hidden browser that feeds the PS3 mirror, if it is running.
  await stopMirror().catch(() => undefined);
  killKioskBrowser();

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
