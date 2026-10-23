import { fetchText } from "../http";
import { itemId, parseFeed, significantWords, similarity } from "../rss";
import { pruneOrphanSources, upsertItems } from "../db";
import { loadConfig } from "../config";
import type { Item, ItemKind } from "../types";
import { requestPlace } from "../business";

interface FeedDef {
  sourceId: string;
  label: string;
  url: string;
  /**
   * Tech, local, 3D printing, or print requests ("lead"); crime is derived
   * from keywords.
   */
  kind: Extract<ItemKind, "tech" | "local" | "print3d" | "lead">;
}

// Verified reachable from a scripted request. CP24's own RSS is 404 since their
// 2024 redesign — CityNews is the same newsroom.
//
// Hacker News was removed deliberately: its titles are link text, not
// headlines ("A Biography of Lee Holloway"), so they read as noise on a
// glanceable screen. Every source here writes descriptive headlines.
export const FEEDS: FeedDef[] = [
  // Techmeme is edited by people: each item is a sentence saying what
  // happened, with the outlet that reported it named. That is the opposite of
  // a headline lifted off a feed, so it carries the most weight here.
  { sourceId: "news.techmeme", label: "Techmeme", url: "https://www.techmeme.com/feed.xml", kind: "tech" },
  // A news desk rather than a gadget blog: outages, prosecutions, policy.
  { sourceId: "news.bbc-tech", label: "BBC Tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", kind: "tech" },
  { sourceId: "news.ars", label: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", kind: "tech" },
  { sourceId: "news.techcrunch", label: "TechCrunch", url: "https://techcrunch.com/feed/", kind: "tech" },
  { sourceId: "news.verge", label: "The Verge", url: "https://www.theverge.com/rss/index.xml", kind: "tech" },
  // Engadget was dropped, not demoted. Its output is overwhelmingly app tips
  // and shopping posts - "This little-known app lets you...", "...is a bit
  // easier with One UI 9" - and no weighting rescues a feed like that.
  { sourceId: "news.citynews", label: "CityNews Toronto", url: "https://toronto.citynews.ca/feed/", kind: "local" },
  { sourceId: "news.cbc-toronto", label: "CBC Toronto", url: "https://www.cbc.ca/webfeed/rss/rss-canada-toronto", kind: "local" },
  { sourceId: "news.global-toronto", label: "Global Toronto", url: "https://globalnews.ca/toronto/feed/", kind: "local" },
  // The 3D printing trade: industry news, and what Bambu and Prusa release —
  // new printers and materials change what is worth offering.
  { sourceId: "print3d.industry", label: "3D Printing Industry", url: "https://3dprintingindustry.com/feed/", kind: "print3d" },
  { sourceId: "print3d.3dprint", label: "3DPrint.com", url: "https://3dprint.com/feed/", kind: "print3d" },
  { sourceId: "print3d.voxel", label: "VoxelMatters", url: "https://www.voxelmatters.com/feed/", kind: "print3d" },
  { sourceId: "print3d.bambu", label: "Bambu Lab", url: "https://blog.bambulab.com/rss/", kind: "print3d" },
  { sourceId: "print3d.prusa", label: "Prusa", url: "https://blog.prusa3d.com/feed/", kind: "print3d" },
  // People asking to have something printed, often paying. Reddit's JSON API
  // refuses scripts now; its RSS does not.
  { sourceId: "leads.reddit", label: "r/3Dprintmything", url: "https://www.reddit.com/r/3Dprintmything/new/.rss", kind: "lead" },
];

export function isCrime(text: string, keywords: string[]): boolean {
  const hay = text.toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

/**
 * Ranking: per-source weight, then a recency decay so a busy feed cannot pin
 * stale headlines to the top, then keyword boost. Muted terms drop the item.
 */
/**
 * Headlines that are not news.
 *
 * Feeds carry a lot of magazine writing — retrospectives, buying guides, "I
 * spent a week with", "the forgotten Chromebook that started it all". They
 * read fine in a feed reader and say nothing at a glance from across the room,
 * which is all this screen is for. These are pushed down rather than dropped,
 * so a quiet news day still has something on it.
 */
const FLUFF = [
  /\bthat started it all\b/i,
  /^the (forgotten|rise|fall|story|history|legacy)\b/i,
  /\b(best|worst|top|cheapest) \d+\b/i,
  /\b(gift|buying|holiday) guide\b/i,
  /\b(hands[- ]on|first look|retrospective|explainer)\b/i,
  /\bI (tried|spent|used|bought|built|wore|drove)\b/i,
  /\b(looking back|years later|a decade of|nostalgia)\b/i,
  /\b(everything you need to know|what to expect|here'?s (how|why|what))\b/i,
  /\bdeals?\b.*\$\d/i,
  // Reference writing: a thing being explained is not a thing happening.
  // "What is infill in 3D printing and is it necessary?" is a manual page.
  /^(what|who|which|where) (is|are|was|were)\b/i,
  /^(how|why) (to|do|does|did|is|are|can|should)\b/i,
  /\b(explained|a guide to|guide for|tutorial|walkthrough|cheat sheet)\b/i,
  /\b(is it (worth|necessary|safe)|do you (need|really need))\b/i,
  /\b(tips|tricks|hacks) (for|to)\b/i,
  /\bvs\.?\b.*\b(what'?s|which is) the (difference|better)\b/i,
  // Advice addressed to the reader. Reporting describes what happened; this
  // tells you what to do about it.
  /\byou (shouldn'?t|should|ought to|need to|might want|can)\b/i,
  /\bcan (improve|save|fix|boost) your\b/i,
  // Shopping. Sale posts are ads, not news, and they flood the feed on a sale
  // weekend. (The dashboard has no deals panel at all, by choice.)
  /\$\d[\d,.]*\s*(off|cheaper|less)\b/i,
  /\b(prime day|black friday|cyber monday|boxing day)\b/i,
  /\b(is|are|drops? to|falls? to) (just |only )?\$\d/i,
  /\b(deal|discount|sale|coupon)s?\b.*\b(today|now|live|back)\b/i,
  // A headline that asks a question is answering it in the body — an
  // explainer, not a report. "How much does DDR5 RAM speed matter for
  // gaming?" and "What's the difference between battery capacity and battery
  // life" both land here, where enumerating the verb forms never would.
  /\?\s*$/,
  /\blet'?s talk about\b/i,
  // Gadget-blog house style: a tip about an app, not a report of an event.
  /\blittle[- ]known\b/i,
  /\blets you\b/i,
  /\bis a bit (easier|better|nicer|simpler)\b/i,
  /^why this\b/i,
  /\b(here'?s|this is) (how|why|what) (you|your|to)\b/i,
];

export function isFluff(title: string): boolean {
  return FLUFF.some((re) => re.test(title));
}

export function scoreItem(
  title: string,
  body: string,
  published: number,
  sourceWeight: number,
  boost: string[],
  now: number,
): number {
  const ageHours = Math.max(0, (now - published) / 3_600_000);
  const recency = 1 / (1 + ageHours / 6);
  const hay = `${title} ${body}`.toLowerCase();
  const boosted = boost.some((b) => b && hay.includes(b.toLowerCase())) ? 2 : 1;
  // Hard enough that reference writing never appears while there is actual
  // news to show, soft enough that a dead-quiet feed still has something.
  const fluff = isFluff(title) ? 0.08 : 1;
  return sourceWeight * recency * boosted * fluff;
}

/** The outlet a curated item is crediting, e.g. "Politico:" at the front. */
const CREDIT = /^\s*([A-Z][\w.&\u2019' -]{1,40}(?:\s*\/\s*[A-Z][\w.&\u2019' -]{1,40})?):\s*/;

/**
 * The one line worth showing under a headline.
 *
 * Feeds put wildly different things in `description`: a real summary, the
 * first paragraph of the article, a newsletter preamble, or the headline
 * again. This strips markup and the "Outlet:" credit a curated feed prefixes,
 * then returns nothing at all when what is left merely repeats the headline —
 * a line that says the same thing twice is worse than no line.
 */
export function cleanSummary(title: string, body: string, limit = 150): string {
  const text = body
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(CREDIT, "");

  if (!text) return "";

  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const t = norm(title);
  const b = norm(text);
  // Repeats the headline, or is a fragment of it: nothing gained.
  if (!b || b === t || b.startsWith(t) || t.startsWith(b)) return "";
  // A curated feed carries the same sentence in both fields, each truncated at
  // its own length — so neither is a prefix of the other, but they open
  // identically. Matching openings is what actually catches it.
  const HEAD = 50;
  if (t.length >= HEAD && b.length >= HEAD && t.slice(0, HEAD) === b.slice(0, HEAD)) return "";

  if (text.length <= limit) return text;
  // Cut on a word, and only keep it if there is a sentence worth of it.
  const cut = text.slice(0, limit);
  const end = cut.lastIndexOf(" ");
  return `${(end > 60 ? cut.slice(0, end) : cut).trimEnd()}…`;
}

export function isMuted(title: string, body: string, mute: string[]): boolean {
  if (!mute.length) return false;
  const hay = `${title} ${body}`.toLowerCase();
  return mute.some((m) => m && hay.includes(m.toLowerCase()));
}

/** Headlines this similar are treated as the same story. */
export const DEDUPE_THRESHOLD = 0.6;

/**
 * Greedy: take items strongest-first and drop any later headline that overlaps
 * one already kept. O(n^2), but n here is a few hundred at most.
 */
export function dedupe(items: Item[], threshold = DEDUPE_THRESHOLD): Item[] {
  const kept: { item: Item; words: Set<string> }[] = [];
  for (const it of [...items].sort((a, b) => b.weight - a.weight)) {
    const words = significantWords(it.title);
    if (!words.size) {
      kept.push({ item: it, words });
      continue;
    }
    if (kept.some((k) => similarity(words, k.words) >= threshold)) continue;
    kept.push({ item: it, words });
  }
  return kept.map((k) => k.item);
}

export async function ingestNews(): Promise<number> {
  const cfg = loadConfig();
  const now = Date.now();
  const collected: Item[] = [];

  const results = await Promise.all(
    FEEDS.map(async (feed) => ({ feed, xml: await fetchText(feed.sourceId, feed.url) })),
  );

  for (const { feed, xml } of results) {
    if (!xml) continue; // health already recorded; other feeds carry on
    const weight = cfg.news.weights[feed.sourceId] ?? 1;
    for (const entry of parseFeed(xml).slice(0, 30)) {
      if (isMuted(entry.title, entry.summary, cfg.news.mute)) continue;
      const crime =
        feed.kind === "local" && isCrime(`${entry.title} ${entry.summary}`, cfg.news.crimeKeywords);
      // A request from Toronto is a customer; one from Oregon mostly is not.
      const place = feed.kind === "lead" ? requestPlace(entry.title) : null;
      const nearby = place === "toronto" ? 4 : place === "ontario" ? 2.5 : place === "canada" ? 1.6 : 1;
      collected.push({
        id: itemId(feed.sourceId, entry.link, entry.title),
        kind: crime ? "crime" : feed.kind,
        sourceId: feed.sourceId,
        title: entry.title,
        // Stored ready to render: the panel shows this under the headline.
        body: cleanSummary(entry.title, entry.summary),
        link: entry.link,
        published: entry.published,
        fetched: now,
        // Requests are often questions ("can anyone print this?"), which the
        // headline scoring would bury; they rank on place and age alone.
        weight: feed.kind === "lead" ? weight * nearby : scoreItem(entry.title, entry.summary, entry.published, weight, cfg.news.boost, now),
        meta: place ? { source: feed.label, place } : { source: feed.label },
      });
    }
  }

  const active = FEEDS.map((f) => f.sourceId);
  // A feed removed from the config must stop appearing immediately.
  for (const kind of ["tech", "local", "crime", "print3d", "lead"]) pruneOrphanSources(kind, active);

  return upsertItems(dedupe(collected));
}
