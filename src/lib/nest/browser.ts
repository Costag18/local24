import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The browser the Nest bridge drives.
 *
 * It runs against its own profile directory, never the user's real one: a
 * profile can only be open in one process at a time, and this window has to be
 * able to sit there for days without getting in the way.
 */

const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

export function findBrowser(): string | null {
  const fromEnv = process.env.LOCAL24_BROWSER;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe")
    : null;
  for (const p of [...CANDIDATES, ...(local ? [local] : [])]) {
    if (existsSync(p)) return p;
  }
  return null;
}

export const PROFILE_DIR = path.resolve(process.cwd(), "data/nest-profile");

const BASE_FLAGS = [
  `--user-data-dir=${PROFILE_DIR}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  // Without these a window that is hidden behind others stops painting, and
  // every screenshot comes back as the last frame it bothered to draw.
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
];

export interface Launched {
  pid: number | null;
  exe: string;
}

function launch(args: string[]): Launched | null {
  const exe = findBrowser();
  if (!exe) return null;
  mkdirSync(PROFILE_DIR, { recursive: true });
  const child = spawn(exe, args, { detached: true, stdio: "ignore" });
  child.unref();
  return { pid: child.pid ?? null, exe };
}

/**
 * Step one: a perfectly ordinary browser window, with no debugging port.
 *
 * Google's sign-in refuses browsers it thinks are automated, and the
 * debugging port is one of the things it looks at — so the sign-in happens in
 * a clean window and only the cookies it leaves behind are reused.
 */
export function launchForSignIn(url: string): Launched | null {
  return launch([...BASE_FLAGS, "--window-size=1920,1080", url]);
}

/** Step two: the same profile, now with the port the bridge talks over. */
export function launchForCapture(port: number, hidden: boolean): Launched | null {
  return launch([
    ...BASE_FLAGS,
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    "--window-size=1920,1080",
    // Only pixels are captured. Without this the hidden window plays camera
    // audio and Google Home's notification sounds with nothing on screen.
    "--mute-audio",
    // Parked far off-screen rather than minimized: a minimized window stops
    // compositing, and there would be nothing to capture.
    ...(hidden ? ["--window-position=-32000,-32000"] : []),
    "about:blank",
  ]);
}

/** Ends the windows this process started. Chrome has no other handle on it. */
export function killBrowser(pid: number): void {
  try {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }).unref();
  } catch {
    /* already gone */
  }
}
