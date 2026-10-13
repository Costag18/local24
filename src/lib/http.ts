import { noteAttempt, noteFailure, noteSuccess } from "./db";

const UA = "LOCAL24/0.1 (personal local dashboard)";

/**
 * Some hosts serve a stub to an unfamiliar user agent — YouTube returns 385
 * bytes to ours — so a caller that needs the real page can ask for a browser
 * one instead.
 */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/**
 * Every outbound request goes through here so that source health, latency and
 * cumulative bytes are recorded in one place. Callers get `null` on failure
 * rather than a throw — one dead feed must never stall the others.
 */
export async function fetchText(
  sourceId: string,
  url: string,
  timeoutMs = 15000,
  userAgent = UA,
): Promise<string | null> {
  noteAttempt(sourceId);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": userAgent, accept: "*/*", "accept-language": "en" },
      cache: "no-store",
    });
    if (!res.ok) {
      noteFailure(sourceId, `HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    noteSuccess(sourceId, Date.now() - started, Buffer.byteLength(text));
    return text;
  } catch (err) {
    noteFailure(sourceId, err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(
  sourceId: string,
  url: string,
  timeoutMs = 15000,
): Promise<T | null> {
  const text = await fetchText(sourceId, url, timeoutMs);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    noteFailure(sourceId, `bad JSON: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function fetchBinary(
  sourceId: string,
  url: string,
  timeoutMs = 12000,
): Promise<Buffer | null> {
  noteAttempt(sourceId);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": UA },
      cache: "no-store",
    });
    if (!res.ok) {
      noteFailure(sourceId, `HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    noteSuccess(sourceId, Date.now() - started, buf.byteLength);
    return buf;
  } catch (err) {
    noteFailure(sourceId, err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Exponential backoff so a failing source stops hammering. Caps at 16x. */
export function backoffFactor(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 1;
  return Math.min(2 ** consecutiveFailures, 16);
}
