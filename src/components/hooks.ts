"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";

/** Ticks every `ms`, for clocks and countdowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * True while the user has interacted recently. Rotation pauses when active and
 * resumes once idle, which is what makes kiosk and interactive the same app.
 */
export function useActivity(idleMs: number): boolean {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const bump = () => {
      setActive(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setActive(false), idleMs);
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [idleMs]);

  return active;
}

/**
 * Advances an index every `dwellMs` unless paused. Returns the index and a
 * setter so a click can jump straight to an item.
 */
export function useRotation(
  count: number,
  dwellMs: number,
  paused: boolean,
): [number, (i: number) => void] {
  const [index, setIndex] = useState(0);

  // A timeout per page rather than one interval: jumping to a page by hand
  // gives it its full dwell, instead of the next tick arriving a moment later
  // and snatching it away.
  useEffect(() => {
    if (paused || count <= 1 || dwellMs <= 0) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), dwellMs);
    return () => clearTimeout(t);
  }, [count, dwellMs, paused, index]);

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  return [count ? index % count : 0, setIndex];
}

/** Per-viewer convenience only (last channel, last playlist). */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* private mode, cleared storage — the default stands */
    }
  }, [key]);

  const set = (v: T) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable; in-memory value still applies */
    }
  };

  return [value, set];
}

interface BatteryLike {
  charging: boolean;
  addEventListener: (t: string, fn: () => void) => void;
  removeEventListener: (t: string, fn: () => void) => void;
}

/**
 * Reports discharging state to the server so polling can slow down. The API is
 * Chromium-only; elsewhere this stays false and nothing changes.
 */
export function useBattery(): boolean {
  const [onBattery, setOnBattery] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (!nav.getBattery) return;
    let battery: BatteryLike | null = null;
    let cancelled = false;

    const sync = () => {
      if (!battery) return;
      const discharging = !battery.charging;
      setOnBattery(discharging);
      void fetch("/api/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job: "none", onBattery: discharging }),
      }).catch(() => undefined);
    };

    void nav.getBattery().then((b) => {
      if (cancelled) return;
      battery = b;
      b.addEventListener("chargingchange", sync);
      sync();
    });

    return () => {
      cancelled = true;
      battery?.removeEventListener("chargingchange", sync);
    };
  }, []);

  return onBattery;
}

/**
 * The size of an element, kept current as its window is resized or split.
 *
 * Rounded to whole pixels so sub-pixel jitter during a divider drag does not
 * re-render on every frame for a change nobody can see.
 */
export function useBox<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, box];
}

/** True when the tab is hidden, so video and camera polling can stand down. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    on();
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

export interface FitLayout {
  /** Track template for the two columns. */
  gridTemplateColumns: string;
  /** Height the video pane must be for a 16:9 picture, or null when unknown. */
  paneHeight: number | null;
}

export interface FitInput {
  width: number;
  height: number;
  /** Height of the pane's own header, which sits above the video. */
  chrome: number;
  gap: number;
  minRight: number;
  minBottom: number;
}

export const FALLBACK_FIT: FitLayout = {
  gridTemplateColumns: "minmax(0, 1.85fr) minmax(300px, 1fr)",
  paneHeight: null,
};

/**
 * Solves for a top-left pane whose *video area* is exactly 16:9. Pure, so it
 * can be tested without a DOM.
 *
 * Only the pane's own width and height are fixed. The two columns then split
 * independently — the camera panel is not tied to the row below the video —
 * which is what keeps the layout from reading as a rigid 2x2 grid.
 *
 * Returns the fallback when the container has no size, which happens before
 * first layout and in hidden tabs.
 */
export function fitSixteenNine(input: FitInput): FitLayout {
  const { width: W, height: H, chrome, gap, minRight, minBottom } = input;
  if (!(W > 0) || !(H > 0)) return FALLBACK_FIT;

  const maxW = W - gap - minRight;
  const maxH = H - gap - minBottom;
  if (maxW <= 0 || maxH <= 0) return FALLBACK_FIT;

  // Prefer the tallest pane the height allows; fall back to width-limited.
  const hByHeight = maxH;
  const wByHeight = ((hByHeight - chrome) * 16) / 9;

  let w: number;
  let h: number;
  if (wByHeight <= maxW) {
    h = hByHeight;
    w = wByHeight;
  } else {
    w = maxW;
    h = (w * 9) / 16 + chrome;
  }

  if (w < 240 || h < 160) return FALLBACK_FIT;

  return {
    gridTemplateColumns: `${Math.round(w)}px minmax(0, 1fr)`,
    paneHeight: Math.round(h),
  };
}

/**
 * Measures the grid container and keeps the video area on a true 16:9.
 *
 * Returns a callback ref rather than taking a RefObject: the container only
 * mounts once data has loaded, and an effect keyed on a ref object would run
 * while `.current` was still null and never re-run.
 */
export function useSixteenNine(
  opts: { minRight?: number; minBottom?: number; gap?: number; chrome?: number } = {},
): { ref: (node: HTMLElement | null) => void; fit: FitLayout } {
  const { minRight = 380, minBottom = 190, gap = 4, chrome = 30 } = opts;
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [fit, setFit] = useState<FitLayout>(FALLBACK_FIT);

  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const slab = node.querySelector(".slab");
      setFit(
        fitSixteenNine({
          width: node.clientWidth,
          height: node.clientHeight,
          chrome: slab instanceof HTMLElement ? slab.offsetHeight : chrome,
          gap,
          minRight,
          minBottom,
        }),
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node, minRight, minBottom, gap, chrome]);

  return { ref: setNode, fit };
}

/**
 * Returns keyboard focus to the page after an embedded player has taken it.
 *
 * Clicking a video hands focus to a cross-origin iframe, which swallows every
 * keystroke — so the shortcuts silently stop working until you click elsewhere.
 * Pointer events over the iframe never reach this document, so a pointermove
 * here means the cursor is back over our own UI, which is exactly when focus
 * should come back. While the pointer is still over the player, keys are left
 * to it, so its own volume and fullscreen controls keep working.
 */
export function useReclaimFocus(): void {
  useEffect(() => {
    const reclaim = () => {
      const el = document.activeElement;
      if (el instanceof HTMLIFrameElement) {
        el.blur();
        // Body needs a tabindex to be focusable at all.
        if (!document.body.hasAttribute("tabindex")) document.body.tabIndex = -1;
        document.body.focus({ preventScroll: true });
      }
    };
    window.addEventListener("pointermove", reclaim, { passive: true });
    window.addEventListener("pointerdown", reclaim, { passive: true });
    return () => {
      window.removeEventListener("pointermove", reclaim);
      window.removeEventListener("pointerdown", reclaim);
    };
  }, []);
}
