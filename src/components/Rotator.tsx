"use client";

import { useEffect, useRef, useState } from "react";
import { useRotation } from "./hooks";
import { PageDots } from "./PageDots";

export interface RotatorPage {
  key: string;
  title: string;
  node: React.ReactNode;
  /** How long this page holds, if not the window's usual dwell. */
  dwellMs?: number;
  /**
   * Stay mounted while another page shows. For the map: its route geometry is
   * the expensive part, and buses should not jump when it comes back.
   */
  keep?: boolean;
}

/**
 * One window that takes turns between whole sections — weather and radar,
 * the home camera and the printer camera.
 *
 * Each page keeps its own header; the rotator only adds a few dots in the
 * middle of it, which show where it is and jump to a page when clicked.
 * Like the rotating panel it holds still while the pointer is moving over it,
 * and resumes ten seconds after the pointer stops (so a parked cursor in the
 * kiosk does not freeze it). The window's lock holds it too.
 */
export function Rotator({ pages, dwellMs, locked = false }: { pages: RotatorPage[]; dwellMs: number; locked?: boolean }) {
  const [reading, setReading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [current, setCurrent] = useState(0);
  const [index, setIndex] = useRotation(pages.length, pages[current]?.dwellMs ?? dwellMs, locked || reading);
  useEffect(() => setCurrent(index), [index]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const page = pages[index] ?? pages[0];
  if (!page) return null;
  if (pages.length === 1) return <>{page.node}</>;

  return (
    <div
      style={{ position: "relative", display: "grid", minWidth: 0, minHeight: 0 }}
      onPointerMove={() => {
        setReading(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setReading(false), 10_000);
      }}
      onPointerLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        setReading(false);
      }}
    >
      {pages.map((p, i) =>
        i === index || p.keep ? (
          <div
            key={p.key}
            className={i === index ? "fade-in" : undefined}
            style={{ display: i === index ? "grid" : "none", gridArea: "1 / 1", minWidth: 0, minHeight: 0 }}
          >
            {p.node}
          </div>
        ) : null,
      )}
      <div className="rotator-dots">
        <PageDots
          titles={pages.map((p) => p.title)}
          index={index}
          onPick={setIndex}
          dwellMs={pages[index]?.dwellMs ?? dwellMs}
          paused={locked || reading}
        />
      </div>
    </div>
  );
}
