import { CdpSession, activateTab, browserSocket, closeTab, debuggerReady, listTargets, openTab } from "./cdp";
import { findBrowser, killBrowser, launchForCapture, launchForSignIn } from "./browser";
import { loadConfig } from "../config";
import type { HomeCam } from "../types";

/**
 * Nest cameras on the dashboard, without paying Google.
 *
 * Google publishes no camera URL: the Smart Device Management API costs a
 * one-time fee and even then hands back a WebRTC session that expires every
 * five minutes, and home.google.com refuses to be framed
 * (`X-Frame-Options: SAMEORIGIN`). What is left is the picture already on
 * screen — so a browser signed into the user's own account keeps each camera
 * open in a tab, and this reads frames straight off it and serves them as
 * ordinary JPEGs, which the Home panel already knows how to display.
 *
 * It is a workaround, and it behaves like one: the window has to stay running,
 * and a change to Google's markup can break the crop.
 */

const PORT = 9333;
const HOME = "https://home.google.com/";
/** Below this the browser is doing more work than the panel can show. */
const MIN_INTERVAL_MS = 700;

export type BridgeMode = "off" | "signin" | "capturing";

interface Frame {
  buf: Buffer;
  at: number;
}

interface State {
  mode: BridgeMode;
  pid: number | null;
  startedAt: number;
  /** Set when the browser lands on an account page instead of a camera. */
  signedOut: boolean;
  lastError: string | null;
}

interface Shared {
  state: State;
  frames: Map<string, Frame>;
  camErrors: Map<string, string>;
  tabs: Map<string, string>; // camera id -> CDP target id
  sessions: Map<string, CdpSession>; // target id -> socket
  loop: ReturnType<typeof setInterval> | null;
  capturing: boolean;
  turn: number;
  lastAutoStart: number;
}

/**
 * Hung off globalThis, not module scope.
 *
 * Next gives each route handler its own copy of a module in development, so
 * plain module state would mean the status route and the image route were
 * looking at two different sets of frames.
 */
const shared: Shared = ((globalThis as { __local24Nest?: Shared }).__local24Nest ??= {
  state: { mode: "off", pid: null, startedAt: 0, signedOut: false, lastError: null },
  frames: new Map(),
  camErrors: new Map(),
  tabs: new Map(),
  sessions: new Map(),
  loop: null,
  capturing: false,
  turn: 0,
  lastAutoStart: 0,
});

const { state, frames, camErrors, tabs, sessions } = shared;

export function nestCams(): HomeCam[] {
  return loadConfig().homeCams.filter((c) => c.kind === "nest" && c.url.trim());
}

export function getNestFrame(id: string): Frame | null {
  return frames.get(id) ?? null;
}

export function nestStatus() {
  // Reading the status is also a signal that something is watching.
  ensureBridge();
  const cams = nestCams();
  return {
    mode: state.mode,
    available: findBrowser() !== null,
    signedOut: state.signedOut,
    lastError: state.lastError,
    startedAt: state.startedAt,
    cameras: cams.map((c) => ({
      id: c.id,
      label: c.label,
      frameAt: frames.get(c.id)?.at ?? null,
      error: camErrors.get(c.id) ?? null,
    })),
  };
}

/** Opens a normal window for the one-time Google sign-in. */
export function startSignIn(): { ok: boolean; error?: string } {
  if (state.mode === "capturing") void stopBridge();
  const launched = launchForSignIn(HOME);
  if (!launched) return { ok: false, error: "no Chrome or Edge found" };
  state.mode = "signin";
  state.pid = launched.pid;
  state.startedAt = Date.now();
  state.lastError = null;
  return { ok: true };
}

export async function startBridge(hidden = true): Promise<{ ok: boolean; error?: string }> {
  const cams = nestCams();
  if (!cams.length) return { ok: false, error: "no Nest cameras configured" };

  // The sign-in window holds the profile, so it has to go first.
  if (state.pid) killBrowser(state.pid);
  await wait(1200);

  const launched = launchForCapture(PORT, hidden);
  if (!launched) return { ok: false, error: "no Chrome or Edge found" };
  state.pid = launched.pid;
  state.startedAt = Date.now();
  state.lastError = null;

  for (let i = 0; i < 30; i++) {
    if (await debuggerReady(PORT)) break;
    await wait(500);
    if (i === 29) {
      state.lastError = "browser did not open its debugging port";
      return { ok: false, error: state.lastError };
    }
  }

  tabs.clear();
  sessions.clear();
  await adoptTabs(cams);

  for (const cam of cams) {
    if (tabs.has(cam.id)) continue;
    const target = await openTab(PORT, cam.url.trim());
    if (target) tabs.set(cam.id, target.id);
    // Cameras load a live stream; opening them all at once starves the first.
    await wait(1500);
  }
  await closeStrayTabs();

  state.mode = "capturing";
  scheduleLoop(cams);
  return { ok: true };
}

/** Two URLs point at the same camera when they share their path. */
function sameCamera(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

/**
 * Takes over the tabs that are already open instead of opening more.
 *
 * The browser outlives the server — it keeps running across restarts, and the
 * tab ids live only in memory. Without this, every start opened another tab
 * per camera and the window filled up with duplicates.
 */
async function adoptTabs(cams: HomeCam[]): Promise<void> {
  const targets = await listTargets(PORT);
  for (const cam of cams) {
    const hit = targets.find((t) => sameCamera(t.url, cam.url.trim()));
    if (hit) tabs.set(cam.id, hit.id);
  }
}

/**
 * Closes everything that is not a camera — the blank tab Chrome starts with,
 * and any leftovers from an earlier run. Never closes the last one, because
 * closing every tab closes the browser.
 */
async function closeStrayTabs(): Promise<void> {
  const keep = new Set(tabs.values());
  const targets = await listTargets(PORT);
  const strays = targets.filter((t) => !keep.has(t.id));
  for (const t of strays) {
    if (targets.length - 1 < 1) break;
    await closeTab(PORT, t.id);
  }
}

/**
 * Brings the bridge back on its own after a reboot.
 *
 * The panel asking for a frame is the signal — there is no point holding a
 * browser open for cameras nobody is looking at. Retried sparingly, because a
 * failure here means launching a browser that will fail again.
 */
export function ensureBridge(): void {
  if (state.mode !== "off" || !nestCams().length) return;
  // Long enough that a failing launch cannot spin, short enough that a server
  // restart is not a minute of blank camera.
  if (Date.now() - shared.lastAutoStart < 20_000) return;
  shared.lastAutoStart = Date.now();
  void startBridge(true);
}

export async function stopBridge(): Promise<void> {
  if (shared.loop) clearInterval(shared.loop);
  shared.loop = null;
  for (const s of sessions.values()) s.close();
  sessions.clear();
  tabs.clear();

  // Chrome re-parents itself as it starts, so killing the process we spawned
  // leaves the real browser running. Asking it to close is the way out; the
  // kill stays as a backstop for a window that never opened its port.
  try {
    const ws = await browserSocket(PORT);
    if (ws) {
      const session = await CdpSession.open(ws, 3000);
      await session.send("Browser.close", {}, 3000).catch(() => {});
      session.close();
    }
  } catch {
    /* fall through to the kill */
  }
  if (state.pid) killBrowser(state.pid);
  state.pid = null;
  state.mode = "off";
}

function scheduleLoop(cams: HomeCam[]) {
  if (shared.loop) clearInterval(shared.loop);
  const interval = Math.max(
    MIN_INTERVAL_MS,
    Math.min(...cams.map((c) => c.refreshMs || 3000)),
  );
  shared.loop = setInterval(() => void captureAll(), interval);
  void captureAll();
}

/**
 * One camera per tick rather than all of them.
 *
 * Reading the video element works on a background tab, so this no longer has
 * to front each camera in turn; going one at a time still keeps the work per
 * tick to what the panel can actually show.
 */
async function captureAll(): Promise<void> {
  if (shared.capturing || state.mode !== "capturing") return;
  shared.capturing = true;
  try {
    const cams = nestCams();
    if (!cams.length) return;
    const cam = cams[shared.turn++ % cams.length];
    await captureOne(cam);
  } finally {
    shared.capturing = false;
  }
}

/**
 * Reads a frame out of the page.
 *
 * The frame is drawn from the `<video>` element onto a canvas rather than
 * screenshotted: Google paints dialogs and controls over the player, and a
 * screenshot of that region catches whatever happens to be on top of it. The
 * canvas sees only the decoded video. If the canvas comes back tainted the
 * rectangle is returned instead and the caller falls back to a screenshot.
 */
const PROBE = `(() => {
  const byText = (re) => [...document.querySelectorAll('button, [role="button"]')]
    .filter((b) => b.offsetParent && re.test((b.textContent || '').trim()));

  // Google's "what you can do on the web" notice, cookie banners and the like
  // sit on top of the player. Only obvious dismissals are clicked.
  for (const b of byText(/^(got it|ok|okay|close|dismiss|no thanks|not now|done|continue)$/i)) b.click();
  for (const b of document.querySelectorAll('[aria-label="Close"], [aria-label="Dismiss"]')) {
    if (b.offsetParent) b.click();
  }

  const resume = byText(/still watching|keep watching|resume|play live|watch live/i)[0];
  const vids = [...document.querySelectorAll('video')]
    .filter((v) => v.getBoundingClientRect().width > 80);
  const v = vids.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!v) {
    if (resume) resume.click();
    return { ok: false, url: location.href, text: (document.body.innerText || '').slice(0, 160) };
  }
  if (v.paused) { if (resume) resume.click(); v.play().catch(() => {}); }

  const r = v.getBoundingClientRect();
  const base = { ok: r.width > 80 && r.height > 60, url: location.href, ready: v.readyState,
                 x: r.x, y: r.y, w: r.width, h: r.height };

  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return { ...base, ok: false, text: 'stream has not started' };
  try {
    const c = document.createElement('canvas');
    c.width = vw; c.height = vh;
    c.getContext('2d').drawImage(v, 0, 0, vw, vh);
    return { ...base, data: c.toDataURL('image/jpeg', 0.92).split(',')[1] };
  } catch (err) {
    return { ...base, tainted: true };
  }
})()`;

interface Probe {
  ok: boolean;
  url?: string;
  text?: string;
  ready?: number;
  /** Base64 JPEG drawn straight off the video element. */
  data?: string;
  /** Set when the canvas was cross-origin and could not be read. */
  tainted?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

async function captureOne(cam: HomeCam): Promise<void> {
  try {
    const session = await sessionFor(cam);
    if (!session) return;

    const probe = await session.send<{ result?: { value?: Probe } }>("Runtime.evaluate", {
      expression: PROBE,
      returnByValue: true,
      awaitPromise: false,
    });
    const info = probe.result?.value;

    if (info?.url && /accounts\.google\.com|ServiceLogin|signin/i.test(info.url)) {
      state.signedOut = true;
      camErrors.set(cam.id, "signed out — sign in again");
      return;
    }
    state.signedOut = false;

    if (!info?.ok) {
      camErrors.set(cam.id, info?.text ? `no video: ${info.text.slice(0, 80)}` : "no video on the page");
      return;
    }

    // The normal path: the decoded frame, with nothing painted over it.
    if (info.data) {
      frames.set(cam.id, { buf: Buffer.from(info.data, "base64"), at: Date.now() });
      camErrors.delete(cam.id);
      return;
    }

    // Fallback for a tainted canvas. This one does see overlays, and the tab
    // has to be in front to paint, so it is only used when there is no choice.
    const id = tabs.get(cam.id);
    if (id) await activateTab(PORT, id);
    await wait(400);

    const shot = await session.send<{ data?: string }>("Page.captureScreenshot", {
      format: "jpeg",
      quality: 90,
      fromSurface: true,
      captureBeyondViewport: false,
      clip: {
        x: Math.max(0, info.x ?? 0),
        y: Math.max(0, info.y ?? 0),
        width: info.w ?? 0,
        height: info.h ?? 0,
        scale: 1,
      },
    });

    if (!shot.data) {
      camErrors.set(cam.id, "browser returned no image");
      return;
    }
    frames.set(cam.id, { buf: Buffer.from(shot.data, "base64"), at: Date.now() });
    camErrors.delete(cam.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "capture failed";
    camErrors.set(cam.id, message);
    state.lastError = message;
    // A broken socket is the common case; drop it so the next tick reconnects.
    const id = tabs.get(cam.id);
    if (id) {
      sessions.get(id)?.close();
      sessions.delete(id);
    }
  }
}

async function sessionFor(cam: HomeCam): Promise<CdpSession | null> {
  let id = tabs.get(cam.id);
  const targets = await listTargets(PORT);

  // The tab can be gone — closed by hand, or lost when the browser restarted.
  if (!id || !targets.some((t) => t.id === id)) {
    // It may still be open from a previous run; take that one rather than
    // stacking another copy beside it. A remembered id that no longer exists
    // has to be forgotten here, or the capture keeps asking for a dead tab.
    const open = targets.find((t) => sameCamera(t.url, cam.url.trim()));
    id = open?.id;
    if (id) tabs.set(cam.id, id);
    else tabs.delete(cam.id);
  }

  if (!id) {
    const fresh = await openTab(PORT, cam.url.trim());
    if (!fresh) {
      camErrors.set(cam.id, "could not open the camera tab");
      return null;
    }
    id = fresh.id;
    tabs.set(cam.id, id);
    await wait(2500); // the stream needs a moment before there is anything to see
  }

  const existing = sessions.get(id);
  if (existing) return existing;

  const target = (await listTargets(PORT)).find((t) => t.id === id);
  if (!target?.webSocketDebuggerUrl) {
    camErrors.set(cam.id, "camera tab is not debuggable");
    return null;
  }
  const session = await CdpSession.open(target.webSocketDebuggerUrl);
  sessions.set(id, session);
  return session;
}

/** Drops a camera's tab and cached frame when it is removed from the config. */
export async function forgetNestCam(id: string): Promise<void> {
  const tab = tabs.get(id);
  if (tab) {
    sessions.get(tab)?.close();
    sessions.delete(tab);
    await closeTab(PORT, tab);
  }
  tabs.delete(id);
  frames.delete(id);
  camErrors.delete(id);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
