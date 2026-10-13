/**
 * Client-safe text helpers.
 *
 * Lives apart from the transit source on purpose: that module reaches into the
 * database and node:crypto, and importing it from a client component pulls
 * those into the browser bundle.
 */

export interface TextPart {
  text: string;
  hit: boolean;
}

/**
 * Splits alert text so the places you actually travel through can be picked
 * out. TTC writes long sentences; the station name is the part that decides
 * whether an alert matters to you.
 */
export function highlightPlaces(text: string, places: string[]): TextPart[] {
  const found: { start: number; end: number }[] = [];
  const lower = text.toLowerCase();

  for (const place of places) {
    const needle = place.trim().toLowerCase();
    if (needle.length < 3) continue;
    let from = 0;
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      // Whole words only, so "Main Street" does not match inside another word.
      const before = at === 0 ? " " : lower[at - 1];
      const after = at + needle.length >= lower.length ? " " : lower[at + needle.length];
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
        found.push({ start: at, end: at + needle.length });
      }
      from = at + needle.length;
    }
  }

  if (!found.length) return [{ text, hit: false }];

  // Merge overlaps so "Broadview" inside "Broadview Station" is one span.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: { start: number; end: number }[] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }

  const parts: TextPart[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) parts.push({ text: text.slice(cursor, r.start), hit: false });
    parts.push({ text: text.slice(r.start, r.end), hit: true });
    cursor = r.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}
