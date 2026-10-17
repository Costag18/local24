"use client";

/**
 * Which page is showing, and how long until the next one.
 *
 * The current page's dot fills from left to right over its dwell, so a glance
 * says whether there is time to finish reading. While the page is held — the
 * pointer is over it or the window is locked — the dot stays solid instead.
 * The fill restarts from empty when the hold ends, which matches the rotation
 * timer: it also gives the page a full dwell again after a hold.
 */
export function PageDots({
  titles, index, onPick, dwellMs, paused,
}: {
  titles: string[];
  index: number;
  onPick: (i: number) => void;
  dwellMs: number;
  paused: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {titles.map((t, i) => {
        const on = i === index;
        return (
          <button
            key={`${t}-${i}`}
            onClick={() => onPick(i)}
            title={t}
            className={`page-dot${on ? " page-dot-on" : ""}`}
          >
            {on && (
              <span
                key={`${index}-${paused ? "held" : "run"}`}
                className={`page-dot-fill${paused ? " page-dot-held" : ""}`}
                style={{ animationDuration: `${dwellMs}ms` }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
