import { createHash } from "node:crypto";

export interface FeedEntry {
  title: string;
  link: string;
  summary: string;
  published: number;
}

const TAG = (name: string) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i");

function decode(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function pick(block: string, ...names: string[]): string {
  for (const n of names) {
    const m = block.match(TAG(n));
    if (m) return decode(m[1]);
  }
  return "";
}

function pickLink(block: string): string {
  // Atom puts the URL in an attribute; RSS puts it in the element body.
  const atom = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
    ?? block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (atom) return decode(atom[1]);
  return pick(block, "link", "guid");
}

/**
 * Deliberately regex-based rather than a full XML parser: these feeds are
 * small, the shapes are well known, and a malformed feed must degrade to
 * "fewer entries" instead of throwing.
 */
export function parseFeed(xml: string): FeedEntry[] {
  if (!xml) return [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  const out: FeedEntry[] = [];
  for (const block of blocks) {
    const title = pick(block, "title");
    if (!title) continue;
    const link = pickLink(block);
    const summary = pick(block, "description", "summary", "content:encoded", "content");
    const dateRaw = pick(block, "pubDate", "published", "updated", "dc:date");
    const parsed = dateRaw ? Date.parse(dateRaw) : NaN;
    out.push({
      title,
      link,
      summary: summary.slice(0, 400),
      published: Number.isFinite(parsed) ? parsed : Date.now(),
    });
  }
  return out;
}

/** Stable id so re-polling updates a row instead of duplicating it. */
export function itemId(sourceId: string, link: string, title: string): string {
  return createHash("sha1").update(`${sourceId}|${link || title}`).digest("hex").slice(0, 16);
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "is",
  "are", "was", "were", "with", "after", "as", "by", "from", "that", "this",
  "says", "say", "new", "over", "into", "its", "his", "her", "their", "today",
  "amid", "about", "will", "has", "have", "been", "more", "than", "but",
]);

/** The meaning-carrying words of a headline, lowercased and de-punctuated. */
export function significantWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Collapses the same story reported by several outlets. Compares the most
 * significant words of each headline rather than the raw string.
 */
export function titleFingerprint(title: string): string {
  return [...significantWords(title)].sort().slice(0, 6).join("-");
}

/**
 * Jaccard overlap of two headlines' significant words. Outlets rarely word a
 * headline identically, so an exact fingerprint match misses most real
 * duplicates — this scores partial overlap instead.
 */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}
