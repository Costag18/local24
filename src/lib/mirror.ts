import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { findBrowser, killBrowser } from "./nest/browser";
import { CdpSession, browserSocket, debuggerReady, listTargets } from "./nest/cdp";

/**
 * The real dashboard, as pictures, for screens that cannot run it.
 *
 * A PlayStation 3's browser cannot run the dashboard (or play its video), but
 * it can show a JPEG. So a hidden Chrome on this computer opens the actual
 * dashboard at 1280x720 and the TV fetches a fresh screenshot of it over and
 * over: it looks exactly like LOCAL 24, map, cameras and all. Video comes
 * through as a fast slideshow without sound.
 *
 * The hidden browser only exists while something is watching. It starts on
 * the first frame request and closes itself a minute after the last one, so
 * it costs nothing when the PS3 is off.
 */

const PORT = 9334;
const PROFILE = path.resolve(process.cwd(), "data/mirror-profile");
export const MIRROR_WIDTH = 1280;
export const MIRROR_HEIGHT = 720;
/** Close the hidden browser this long after the last frame was asked for. */
const IDLE_MS = 60_000;
/** Never capture more often than this: two frames a second is plenty for a TV. */
const MIN_FRAME_MS = 450;

interface Hub {
  pid: number | null;
  session: CdpSession | null;
  starting: Promise<boolean> | null;
  capturing: Promise<Buffer | null> | null;
  frame: Buffer | null;
  frameAt: number;
  lastAsked: number;
  idler: ReturnType<typeof setInterval> | null;
  error: string | null;
}

// On globalThis so every route shares one browser (Next gives each route its
// own copy of a module).
const g = globalThis as unknown as { __local24Mirror?: Hub };
const hub: Hub = (g.__local24Mirror ??= {
  pid: null, session: null, starting: null, capturing: null, frame: null, frameAt: 0, lastAsked: 0, idler: null, error: null,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start(): Promise<boolean> {
  const exe = findBrowser();
  if (!exe) {
    hub.error = "Chrome or Edge is not installed";
    return false;
  }
  mkdirSync(PROFILE, { recursive: true });
  if (!(await debuggerReady(PORT))) {
    const child = spawn(exe, [
      "--headless=new",
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      `--window-size=${MIRROR_WIDTH},${MIRROR_HEIGHT}`,
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `http://127.0.0.1:${process.env.PORT ?? 3100}/?kiosk=1`,
    ], { detached: true, stdio: "ignore" });
    child.unref();
    hub.pid = child.pid ?? null;
  }
  for (let i = 0; i < 40 && !(await debuggerReady(PORT)); i++) await sleep(500);
  const page = (await listTargets(PORT))[0];
  if (!page?.webSocketDebuggerUrl) {
    hub.error = "the hidden browser did not open the dashboard";
    return false;
  }
  hub.session = await CdpSession.open(page.webSocketDebuggerUrl);
  await hub.session.send("Emulation.setDeviceMetricsOverride", {
    width: MIRROR_WIDTH, height: MIRROR_HEIGHT, deviceScaleFactor: 1, mobile: false,
  });
  // Chrome pushes a frame every time the page repaints, so a moving video
  // arrives as fast as it plays (up to the screen's rate) instead of one
  // screenshot per request. Each frame must be acknowledged or it stops.
  const session = hub.session;
  session.on("Page.screencastFrame", (params) => {
    const f = params as { data?: string; sessionId?: number };
    if (f.data) {
      hub.frame = Buffer.from(f.data, "base64");
      hub.frameAt = Date.now();
    }
    void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  await session.send("Page.enable").catch(() => undefined);
  await session.send("Page.startScreencast", {
    // Every other paint (about 30 a second) is plenty, and quality 60 keeps a
    // frame near 90 KB so an older TV on Wi-Fi can keep up.
    format: "jpeg", quality: 60, maxWidth: MIRROR_WIDTH, maxHeight: MIRROR_HEIGHT, everyNthFrame: 2,
  });
  // Give the dashboard a moment to draw its first frame of real data.
  await sleep(2500);
  hub.error = null;
  hub.idler ??= setInterval(() => {
    if (Date.now() - hub.lastAsked > IDLE_MS) void stop();
  }, 15_000);
  return true;
}

export async function stop(): Promise<void> {
  if (hub.idler) clearInterval(hub.idler);
  hub.idler = null;
  hub.session?.close();
  hub.session = null;
  // Chrome re-parents itself, so the pid alone may miss it: ask it to close.
  const ws = await browserSocket(PORT);
  if (ws) {
    try {
      const s = await CdpSession.open(ws, 3000);
      await s.send("Browser.close", {}, 3000).catch(() => undefined);
      s.close();
    } catch {
      /* already gone */
    }
  }
  if (hub.pid) killBrowser(hub.pid);
  hub.pid = null;
  hub.frame = null;
  hub.frameAt = 0;
}

async function capture(): Promise<Buffer | null> {
  if (!hub.session) return null;
  try {
    const shot = await hub.session.send<{ data: string }>("Page.captureScreenshot", {
      format: "jpeg",
      quality: 72,
      optimizeForSpeed: true,
    });
    return Buffer.from(shot.data, "base64");
  } catch {
    // The page or the browser went away; the next request starts it again.
    hub.session?.close();
    hub.session = null;
    return null;
  }
}

/** The newest picture of the dashboard, starting the hidden browser if needed. */
export async function mirrorFrame(): Promise<{ jpg: Buffer | null; at: number; error: string | null }> {
  hub.lastAsked = Date.now();
  if (!hub.session) {
    hub.starting ??= start().catch((err) => {
      hub.error = err instanceof Error ? err.message : String(err);
      return false;
    }).finally(() => {
      hub.starting = null;
    });
    await hub.starting;
  }
  // A screencast frame is the newest picture there is: nothing has repainted
  // since. Only a page that has not painted at all needs a screenshot.
  if (hub.frame && (Date.now() - hub.frameAt < MIN_FRAME_MS || hub.session)) {
    return { jpg: hub.frame, at: hub.frameAt, error: null };
  }
  hub.capturing ??= capture().finally(() => {
    hub.capturing = null;
  });
  const jpg = await hub.capturing;
  if (jpg) {
    hub.frame = jpg;
    hub.frameAt = Date.now();
  }
  return { jpg: jpg ?? hub.frame, at: hub.frameAt, error: jpg || hub.frame ? null : hub.error ?? "no picture yet" };
}
