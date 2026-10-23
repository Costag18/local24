import { getBlob, noteAttempt, noteFailure, noteSuccess, putBlob } from "../db";
import { loadConfig } from "../config";

/**
 * What 3D-printed things are actually selling, from eBay.
 *
 * eBay hides sold listings behind a sign-in now, but its ordinary search
 * results still print each listing's running total ("69 sold"). So every few
 * hours the same searches are read again and each listing's total is kept;
 * the difference against the reading about a day earlier is what that listing
 * sold in the last day. Until a day of readings exists, the panel ranks by
 * total sold and says so.
 */

const KEY = "ebay.trending";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Readings older than this are dropped; three days covers a missed run or two. */
const KEEP_MS = 3 * DAY_MS;

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-CA,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "sec-ch-ua": '"Chromium";v="141", "Google Chrome";v="141", "Not?A_Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

export interface EbayCard {
  id: string;
  title: string;
  price: string;
  sold: number;
  image: string | null;
}

export interface SellerItem extends EbayCard {
  url: string;
  /** Which configured search found it. */
  query: string;
  /** Sold since the reading about a day ago; null until there is one. */
  soldToday: number | null;
  /** Running total readings, oldest first. */
  history: { at: number; sold: number }[];
}

/** Not things someone made on a printer: printers, scanners, filament, parts for printers. */
const NOT_A_PRINT = /\b(3d printer|printer (kit|parts?|nozzle|hotend|bed)|scanner|filament|resin\b|nozzle|hotend|extruder|build plate|pei sheet|bambu lab [axp]\d|ender[- ]?\d|creality k\d|anycubic|elegoo|prusa mk)\b/i;

/** Every listing card on a search page that shows a sold count. */
export function parseEbayCards(html: string): EbayCard[] {
  const out: EbayCard[] = [];
  for (const part of html.split(/<li[^>]*data-listingid=/).slice(1)) {
    const id = /^"?(\d{9,15})/.exec(part)?.[1];
    const title = /s-card__title"?>\s*<span[^>]*>([^<]+)/.exec(part)?.[1]?.trim();
    const sold = /([\d,]+)\+? sold</.exec(part)?.[1];
    if (!id || !title || !sold) continue;
    const price = /s-card__price[^>]*>([^<]+)/.exec(part)?.[1]?.trim() ?? "";
    const img = /<img[^>]+?(?:data-defer-load|src)=["']?(https:\/\/i\.ebayimg\.com\/[^"'\s>]+)/.exec(part)?.[1] ?? null;
    out.push({
      id,
      title: decode(title),
      price,
      sold: Number(sold.replace(/,/g, "")),
      // Bigger thumbnails than the 140px the search page uses.
      image: img ? img.replace(/s-l\d+\./, "s-l300.") : null,
    });
  }
  return out;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** A printed product rather than printer hardware, judged from the title. */
export function isPrintedProduct(title: string): boolean {
  return /3d[- ]?print/i.test(title) && !NOT_A_PRINT.test(title);
}

/**
 * Sold in the last day: today's total minus the reading closest to 24 hours
 * ago, as long as that reading is at least 20 hours old. Null without one.
 */
export function soldInLastDay(history: { at: number; sold: number }[], now: number): number | null {
  const old = history.filter((h) => now - h.at >= 20 * 60 * 60 * 1000);
  if (!old.length || !history.length) return null;
  const base = old.reduce((best, h) => (Math.abs(now - h.at - DAY_MS) < Math.abs(now - best.at - DAY_MS) ? h : best));
  const latest = history[history.length - 1];
  return Math.max(0, latest.sold - base.sold);
}

/** Folds a fresh reading into what is stored, trimming old readings. */
export function mergeSellers(stored: SellerItem[], fresh: (EbayCard & { query: string })[], now: number): SellerItem[] {
  const byId = new Map(stored.map((s) => [s.id, s]));
  for (const f of fresh) {
    const prev = byId.get(f.id);
    const history = [...(prev?.history ?? []).filter((h) => now - h.at < KEEP_MS), { at: now, sold: f.sold }];
    byId.set(f.id, {
      ...f,
      url: `https://www.ebay.com/itm/${f.id}`,
      history,
      soldToday: soldInLastDay(history, now),
    });
  }
  return [...byId.values()].filter((s) => now - s.history[s.history.length - 1].at < KEEP_MS);
}

/** Best sellers first: by the last day's sales once known, else by total. */
export function rankSellers(items: SellerItem[], limit = 40): SellerItem[] {
  return [...items]
    .sort((a, b) => (b.soldToday ?? -1) - (a.soldToday ?? -1) || b.sold - a.sold)
    .slice(0, limit);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Searches read per run. Few and spaced: eBay blocks a burst of searches. */
const PER_RUN = 2;
const GAP_MS = 15_000;

/**
 * A couple of searches per run, taking turns through the list. Ten searches
 * in a minute got the connection blocked; two every 45 minutes is a few page
 * loads an hour, and every search still comes round about every four hours —
 * often enough for a "sold in the last day" difference. A refusal ends the run
 * at once rather than pressing on.
 */
export async function ingestEbay(): Promise<number> {
  const queries = loadConfig().business.ebayQueries;
  if (!queries.length) return 0;
  const turn = getBlob<number>("ebay.turn")?.value ?? 0;
  const batch = Array.from({ length: Math.min(PER_RUN, queries.length) }, (_, i) => queries[(turn + i) % queries.length]);
  putBlob("ebay.turn", (turn + batch.length) % queries.length);

  const fresh: (EbayCard & { query: string })[] = [];
  for (const [i, q] of batch.entries()) {
    if (i > 0) await wait(GAP_MS);
    const source = "ebay.search";
    noteAttempt(source);
    const started = Date.now();
    try {
      const res = await fetch(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&_ipg=120`, {
        headers: BROWSER_HEADERS,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        noteFailure(source, `HTTP ${res.status}`);
        break;
      }
      const html = await res.text();
      noteSuccess(source, Date.now() - started, html.length);
      for (const c of parseEbayCards(html)) if (isPrintedProduct(c.title)) fresh.push({ ...c, query: q });
    } catch (err) {
      noteFailure(source, err instanceof Error ? err.message : String(err));
      break;
    }
  }
  if (!fresh.length) return 0;
  const now = Date.now();
  const merged = mergeSellers(getBlob<SellerItem[]>(KEY)?.value ?? [], fresh, now);
  putBlob(KEY, merged);
  return merged.length;
}

export function getSellers(limit = 40): { items: SellerItem[]; tracking: boolean } {
  const all = getBlob<SellerItem[]>(KEY)?.value ?? [];
  return { items: rankSellers(all, limit), tracking: all.some((s) => s.soldToday !== null) };
}
