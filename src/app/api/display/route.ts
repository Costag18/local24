import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const PID_FILE = path.resolve(ROOT, "data/kiosk.pid");
const SCRIPT = path.resolve(ROOT, "tools/move-window.ps1");

/**
 * Moves the kiosk window to the next monitor.
 *
 * A page cannot move its own window across displays — the browser will not let
 * it — so the server does it with the window handle instead. The kiosk's pid
 * is recorded at launch; the script falls back to finding the window by title
 * when the dashboard is open in an ordinary window rather than the kiosk.
 */
export async function POST() {
  if (!existsSync(SCRIPT)) {
    return NextResponse.json({ ok: false, error: "mover script missing" }, { status: 500 });
  }

  const pid = existsSync(PID_FILE) ? Number(readFileSync(PID_FILE, "utf8").trim()) : 0;

  const out = await new Promise<string>((resolve) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-ProcessId", String(pid || 0)],
      { windowsHide: true },
    );
    let text = "";
    ps.stdout.on("data", (b) => (text += String(b)));
    ps.stderr.on("data", (b) => (text += String(b)));
    ps.on("close", () => resolve(text.trim()));
    // Never leave the request hanging on a wedged shell.
    setTimeout(() => resolve(text.trim() || "timed out"), 8000);
  });

  const moved = /moved to/i.test(out);
  const single = /only one monitor/i.test(out);
  return NextResponse.json({ ok: moved, single, detail: out.slice(0, 200) });
}
