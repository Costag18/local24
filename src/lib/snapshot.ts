import { buildState } from "./state";
import { changeVersion } from "./live";

interface Snapshot {
  /** The state as sent, including the clock. */
  json: string;
  /** The same state without the clock, for "did anything change?". */
  fingerprint: string;
  at: number;
  version: number;
}

const g = globalThis as unknown as { __local24Snapshot?: { current: Snapshot | null } };
const cache = (g.__local24Snapshot ??= { current: null });

/**
 * The current state, shared by every open screen and built at most once a
 * second — or straight away after a source reports new data. `buildState`
 * puts `now` first, so the fingerprint is the same text with that one field
 * cut off: no second serialisation of a 100 KB object.
 */
export function snapshot(): Snapshot {
  const now = Date.now();
  const version = changeVersion();
  const hit = cache.current;
  if (hit && hit.version === version && now - hit.at < 1000) return hit;
  const json = JSON.stringify(buildState());
  cache.current = { json, fingerprint: json.replace(/^\{"now":\d+,/, "{"), at: now, version };
  return cache.current;
}
