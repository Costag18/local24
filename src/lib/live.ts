/**
 * The live link between the poller and the screens.
 *
 * Every connected screen used to rebuild the whole state on its own ten-second
 * timer, so a change could take ten seconds to appear and three screens did
 * the work three times. Now the state is built once per change and shared:
 * when a source finishes refreshing, the poller calls `notifyChanged`, and
 * every open stream sends the new state straight away.
 *
 * It also records whether anyone is watching, so polling that only matters on
 * screen — bus positions every five seconds — can rest while nobody is.
 *
 * Deliberately imports nothing, so the poller can use it without a cycle;
 * the shared snapshot itself lives in lib/snapshot.ts. On globalThis because
 * Next gives each route its own copy of a module in development.
 */

interface Hub {
  audienceAt: number;
  /** Bumped on every change, so a cached snapshot knows it is out of date. */
  version: number;
  listeners: Set<() => void>;
  pending: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __local24Live?: Hub };
const hub: Hub = (g.__local24Live ??= { audienceAt: 0, version: 0, listeners: new Set(), pending: null });

/** A screen is connected or just asked for data. */
export function noteAudience(): void {
  hub.audienceAt = Date.now();
}

/** Whether any screen has been open in the last `withinMs`. */
export function hasAudience(withinMs = 2 * 60_000): boolean {
  return Date.now() - hub.audienceAt < withinMs;
}

/**
 * A source has new data. Bursts (every job finishing at start-up) are folded
 * into one push a moment later.
 */
export function notifyChanged(): void {
  if (hub.pending) return;
  hub.pending = setTimeout(() => {
    hub.pending = null;
    hub.version++;
    for (const fn of hub.listeners) {
      try {
        fn();
      } catch {
        /* one broken stream must not stop the others */
      }
    }
  }, 300);
}

export function onChanged(fn: () => void): () => void {
  hub.listeners.add(fn);
  return () => hub.listeners.delete(fn);
}

export function changeVersion(): number {
  return hub.version;
}
