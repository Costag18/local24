"use client";

import { useSyncExternalStore } from "react";

/**
 * Volume for the main pane, kept outside React.
 *
 * The video pane is covered by a transparent shield so YouTube's own hover UI
 * never appears, which also means its controls are unreachable — so the volume
 * lives here instead, where the command palette and the hotkeys can both reach
 * it without threading props through the layout.
 */
export interface PlayerState {
  /** 0–100. */
  volume: number;
  muted: boolean;
}

const KEY = "local24.player";
const DEFAULT: PlayerState = { volume: 60, muted: true };

let state: PlayerState = DEFAULT;
let hydrated = false;
const listeners = new Set<() => void>();

function read(): PlayerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<PlayerState>;
    return {
      volume: clampVolume(typeof p.volume === "number" ? p.volume : DEFAULT.volume),
      muted: p.muted !== false,
    };
  } catch {
    return DEFAULT;
  }
}

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  // The first subscriber pulls the saved value; doing it at module scope would
  // touch localStorage during SSR.
  if (!hydrated) {
    hydrated = true;
    state = read();
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(next: PlayerState) {
  if (next.volume === state.volume && next.muted === state.muted) return;
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode: the volume just does not persist.
  }
  emit();
}

export function getPlayerState(): PlayerState {
  return state;
}

/** Moving the slider is an explicit choice, so it also settles the mute. */
export function setVolume(v: number) {
  const volume = clampVolume(v);
  set({ volume, muted: volume === 0 });
}

export function nudgeVolume(delta: number) {
  const volume = clampVolume(state.volume + delta);
  set({ volume, muted: volume === 0 });
}

export function setMuted(muted: boolean) {
  // Unmuting at zero would be silent, so give it something audible.
  set({ muted, volume: !muted && state.volume === 0 ? 20 : state.volume });
}

export function toggleMuted() {
  setMuted(!state.muted);
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(subscribe, getPlayerState, () => DEFAULT);
}

/**
 * The YouTube iframe API without loading the API script: the player accepts
 * JSON commands over postMessage once `enablejsapi=1` is on the embed URL.
 */
export function postPlayerCommand(
  frame: HTMLIFrameElement | null,
  func: string,
  args: unknown[] = [],
) {
  const win = frame?.contentWindow;
  if (!win) return;
  try {
    win.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  } catch {
    // Cross-origin refusals are expected for non-YouTube sources.
  }
}

export function applyPlayerState(frame: HTMLIFrameElement | null, s: PlayerState) {
  postPlayerCommand(frame, "setVolume", [s.volume]);
  postPlayerCommand(frame, s.muted || s.volume === 0 ? "mute" : "unMute", []);
}

/**
 * The player answers a `listening` handshake with a stream of `infoDelivery`
 * messages — duration, the playlist it is holding, which item is playing. That
 * is the only way to pick a *random* video or timestamp without knowing
 * anything about the source up front.
 */
export function startListening(frame: HTMLIFrameElement | null) {
  const win = frame?.contentWindow;
  if (!win) return;
  try {
    win.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
  } catch {
    /* not a YouTube frame */
  }
}

export interface PlayerInfo {
  duration?: number;
  playlist?: string[];
  playlistIndex?: number;
  playerState?: number;
  errorCode?: number;
}

export interface PlayerEvent {
  event: string;
  info?: PlayerInfo;
  /** Set for a video that will not play — removed, private, or embed-blocked. */
  errorCode?: number;
}

/**
 * Reads one message off the player's bus.
 *
 * An error arrives two different ways depending on the build — as `onError`
 * with a bare numeric `info`, or as an `errorCode` inside the usual
 * `infoDelivery` — so both are folded into one shape here.
 */
export function parsePlayerEvent(data: unknown): PlayerEvent | null {
  if (typeof data !== "string" || !data.startsWith("{")) return null;
  try {
    const msg = JSON.parse(data) as { event?: string; info?: unknown };
    if (typeof msg.event !== "string") return null;

    if (typeof msg.info === "number") {
      return { event: msg.event, errorCode: msg.event === "onError" ? msg.info : undefined };
    }
    const info = msg.info && typeof msg.info === "object" ? (msg.info as PlayerInfo) : undefined;
    const errorCode = typeof info?.errorCode === "number" ? info.errorCode : undefined;
    return { event: msg.event, info, errorCode };
  } catch {
    return null;
  }
}

/** Just the `infoDelivery` payload, which is what the randomiser reads. */
export function parsePlayerMessage(data: unknown): PlayerInfo | null {
  const msg = parsePlayerEvent(data);
  return msg?.event === "infoDelivery" && msg.info ? msg.info : null;
}

/** 5, 100, 101 and 150 all mean "this one will not play here". */
export function isUnplayable(code: number | undefined): boolean {
  return code === 5 || code === 100 || code === 101 || code === 150;
}

/** Below a minute there is no meaningful "random time" to jump to. */
export function randomStartSeconds(duration: number, rand: () => number = Math.random): number {
  if (!Number.isFinite(duration) || duration < 60) return 0;
  // Never land in the last stretch, which would look like a channel that is
  // always about to end.
  return Math.floor(rand() * duration * 0.8);
}

export function randomIndex(length: number, rand: () => number = Math.random): number {
  if (!Number.isFinite(length) || length < 2) return 0;
  return Math.floor(rand() * length);
}
