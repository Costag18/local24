"use client";

/**
 * A placeholder while a panel waits for its first data: a few softly
 * shimmering bars in the shape of what is coming, instead of the word
 * "Loading…" sitting in an empty box.
 */
export function Skeleton({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label={label ?? "Loading"}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <span className="skeleton" style={{ width: 28, height: 22, flex: "0 0 auto" }} />
          <span className="flex flex-col gap-1.5" style={{ flex: 1, minWidth: 0 }}>
            <span className="skeleton" style={{ width: `${88 - ((i * 17) % 40)}%`, height: 9 }} />
            <span className="skeleton" style={{ width: `${52 - ((i * 11) % 24)}%`, height: 7 }} />
          </span>
        </div>
      ))}
      {label && <div className="label skeleton-label">{label}</div>}
    </div>
  );
}
