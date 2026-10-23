import { NextResponse } from "next/server";
import { BROWSER_UA } from "@/lib/http";
import { extractArticle, isPublicUrl, type Article } from "@/lib/reader";
import { printablesArticle, printablesTarget } from "@/lib/printablesReader";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 30 * 60_000;

const g = globalThis as unknown as { __local24Reader?: Map<string, { at: number; article: Article }> };
const cache = (g.__local24Reader ??= new Map());

/**
 * Fetches a page, following redirects by hand so that every hop is checked
 * against `isPublicUrl` — a public link must not bounce the server onto a
 * machine on the home network.
 */
async function fetchPage(start: string): Promise<{ html: string; url: string } | { error: string }> {
  let url = start;
  for (let hop = 0; hop < 6; hop++) {
    if (!isPublicUrl(url)) return { error: "That link is not a public web page." };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: ctrl.signal,
        cache: "no-store",
        headers: { "user-agent": BROWSER_UA, accept: "text/html,*/*", "accept-language": "en" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        url = new URL(res.headers.get("location") as string, url).toString();
        continue;
      }
      if (!res.ok || !res.body) return { error: `The site answered ${res.status}.` };
      if (!/html|xml/i.test(res.headers.get("content-type") ?? "")) return { error: "That link is not a web page." };

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        chunks.push(value);
        if (size > MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
      return { html: Buffer.concat(chunks).toString("utf8"), url };
    } catch (err) {
      return { error: err instanceof Error && err.name === "AbortError" ? "The site took too long." : "Could not reach the site." };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: "Too many redirects." };
}

const MAX_CACHED = 60;

/**
 * Keeps a page for a while, never more than MAX_CACHED of them: expired ones
 * go first, then the oldest. Every path into the cache goes through here, so
 * a stream of distinct links cannot grow it without limit.
 */
function remember(key: string, article: Article): void {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
  cache.delete(key); // re-inserting moves it to the newest end
  cache.set(key, { at: now, article });
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
}

/**
 * The cache key for a link. A Printables model or search is keyed on what it
 * names (the id, the words), so the same page reached by differently spelled
 * links is one entry, not many.
 */
function cacheKey(url: string): string {
  const t = printablesTarget(url);
  if (t?.kind === "model") return `printables:model:${t.id}`;
  if (t?.kind === "search") return `printables:search:${t.q.toLowerCase().replace(/\s+/g, " ")}`;
  return url;
}

/** The readable version of one link, for the in-dashboard reader. */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!isPublicUrl(url)) return NextResponse.json({ error: "That link is not a public web page." }, { status: 400 });

  const key = cacheKey(url);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.article);

  // Printables' pages are behind a bot check; its API is not.
  const fromApi = await printablesArticle(url);
  if (fromApi) {
    remember(key, fromApi);
    return NextResponse.json(fromApi);
  }

  const page = await fetchPage(url);
  if ("error" in page) return NextResponse.json({ error: page.error }, { status: 502 });
  const article = extractArticle(page.html, page.url);

  remember(key, article);
  return NextResponse.json(article);
}
