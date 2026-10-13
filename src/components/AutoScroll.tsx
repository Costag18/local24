"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Props {
  /** Forces a stop regardless of hover (e.g. a pinned panel). */
  paused?: boolean;
  /** How long this panel is on screen at a time; the pace is fitted to it. */
  cycleMs?: number;
  /** Fallback pace when there is no dwell to fit, in pixels per second. */
  speed?: number;
  /**
   * Multiplies the lap time. 4 means a quarter of the fitted pace — a full
   * pass spans several panel dwells, which is slow enough to actually read.
   */
  slowness?: number;
  /** Where to start, as a fraction of one lap (0 = top). */
  start?: number;
  /** Called on unmount with the fraction reached, so a revisit can resume. */
  onLeave?: (fraction: number) => void;
  children: React.ReactNode;
}

/**
 * Loops a list vertically when it is taller than its container, and leaves it
 * alone when it already fits.
 *
 * The track renders the children twice, so scrolling one copy's height brings
 * the top back into exactly the place it started: the list wraps around
 * instead of jumping. Position is driven from a frame loop rather than a CSS
 * animation because the carousel needs to know where it stopped — a panel
 * that rotates away and comes back picks up where it left off.
 */
export function AutoScroll({
  paused = false,
  cycleMs,
  speed = 22,
  slowness = 4,
  start = 0,
  onLeave,
  children,
}: Props) {
  const [hover, setHover] = useState(false);
  const viewport = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);

  /** Pixels per second; 0 when the content fits and nothing moves. */
  const [pace, setPace] = useState(0);
  const lap = useRef(0); // height of one copy
  const offset = useRef(-1); // -1 until the first measure places it
  const stopped = useRef(false);
  stopped.current = paused || hover;

  useEffect(() => {
    const vp = viewport.current;
    const inner = content.current;
    if (!vp || !inner || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const h = inner.scrollHeight;
      if (h <= vp.clientHeight + 2) {
        lap.current = 0;
        setPace(0);
        return;
      }
      // Keep the same place in the list when the list itself changes size.
      if (offset.current < 0) offset.current = (start % 1) * h;
      else if (lap.current) offset.current = (offset.current / lap.current) * h;
      lap.current = h;

      const natural = h / speed;
      const fitted = cycleMs ? Math.max(6, cycleMs / 1000) : natural;
      const seconds = (cycleMs ? Math.min(natural, fitted) : natural) * slowness;
      setPace(h / seconds);
    };

    measure();
    // New content changes the inner box's size, which this observer reports,
    // so there is no need to re-subscribe on every render — the panel's
    // parent re-renders every few seconds with fresh-but-identical children.
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    ro.observe(inner);
    return () => ro.disconnect();
    // `start` is only read for the first placement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed, cycleMs, slowness]);

  useEffect(() => {
    const el = track.current;
    if (!pace || !el) return;
    let raf = 0;
    let last = performance.now();

    const tick = (t: number) => {
      // Clamped so a background tab coming back does not leap a screenful.
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (!stopped.current && lap.current) {
        offset.current = (Math.max(0, offset.current) + pace * dt) % lap.current;
      }
      el.style.transform = `translate3d(0, ${-Math.max(0, offset.current)}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pace]);

  // Layout cleanup runs before the DOM goes away, while the refs still hold.
  const leave = useRef(onLeave);
  leave.current = onLeave;
  useLayoutEffect(
    () => () => {
      if (lap.current && offset.current >= 0) leave.current?.(offset.current / lap.current);
    },
    [],
  );

  const scrolling = pace > 0;

  return (
    <div
      ref={viewport}
      className="vcrawl h-full"
      style={{ minHeight: 0 }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <div
        ref={track}
        style={scrolling ? { willChange: "transform" } : { transform: "none" }}
      >
        <div ref={content}>{children}</div>
        {/* Second copy only exists to make the loop seamless. */}
        {scrolling && <div aria-hidden>{children}</div>}
      </div>
    </div>
  );
}
