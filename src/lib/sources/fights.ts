import { load } from "cheerio";
import { fetchText } from "../http";
import { putBlob } from "../db";
import { loadConfig } from "../config";
import type { Fight, FightCard } from "../types";
import { CARD_RUNTIME_MS } from "../format";

const UFC_EVENTS = "https://www.ufc.com/events";
const ONE_EVENTS = "https://www.onefc.com/events/";
const PFL_EVENTS = "https://www.pflmma.com/events";

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

function abs(base: string, href: string): string {
  if (!href) return base;
  if (/^https?:/i.test(href)) return href;
  return new URL(href, base).toString();
}

// --- UFC --------------------------------------------------------------------
// The events listing carries `data-main-card-timestamp` (epoch seconds) per
// card, so upcoming events need no per-event fetch. Bout order is pulled from
// the event page only for a card happening today.

export function parseUfcEvents(html: string): FightCard[] {
  const $ = load(html);
  const out: FightCard[] = [];
  $(".c-card-event--result__info").each((_, el) => {
    const block = $(el);
    const link = block.find(".c-card-event--result__headline a").first();
    const name = clean(link.text());
    const href = link.attr("href") ?? "";
    if (!name || !href) return;
    const dateEl = block.find(".c-card-event--result__date").first();
    const ts = Number(dateEl.attr("data-main-card-timestamp"));
    const location = clean(block.find(".c-card-event--result__location").text());
    out.push({
      id: `ufc:${href.split("/").pop()}`,
      promotion: "UFC",
      name,
      startsAt: Number.isFinite(ts) && ts > 0 ? ts * 1000 : null,
      venue: location.split(",")[0] ?? "",
      location,
      posterUrl: null,
      link: abs(UFC_EVENTS, href),
      fights: [],
      isToday: false,
      source: "scrape",
    });
  });
  return out;
}

/** Bout order for a single UFC event page. Selectors match ufc.com's card list. */
export function parseUfcCard(html: string): Fight[] {
  const $ = load(html);
  const fights: Fight[] = [];
  $(".c-listing-fight").each((_, el) => {
    const f = $(el);
    const red = clean(f.find(".c-listing-fight__corner-name--red").first().text());
    const blue = clean(f.find(".c-listing-fight__corner-name--blue").first().text());
    if (!red || !blue) return;
    const weightClass = clean(f.find(".c-listing-fight__class-text").first().text());
    fights.push({
      bout: `${red} vs ${blue}`,
      weightClass,
      redName: red,
      blueName: blue,
      isMain: false,
      isTitle: /title|championship/i.test(weightClass),
    });
  });
  // ufc.com lists the main event first within the main card.
  if (fights.length) fights[0].isMain = true;
  return fights;
}

// --- ONE --------------------------------------------------------------------

export function parseOneEvents(html: string): FightCard[] {
  const $ = load(html);
  const out: FightCard[] = [];
  $(".simple-post-card.is-event").each((_, el) => {
    const c = $(el);
    const title = c.find("a.title").first();
    const name = clean(title.text());
    if (!name) return;
    const href = title.attr("href") ?? ONE_EVENTS;
    const ts = Number(c.find(".datetime").first().attr("data-timestamp"));
    const location = clean(c.find(".location").first().text());
    out.push({
      id: `one:${href.replace(/\/$/, "").split("/").pop()}`,
      promotion: "ONE",
      name,
      startsAt: Number.isFinite(ts) && ts > 0 ? ts * 1000 : null,
      venue: location.split(",")[0] ?? "",
      location,
      posterUrl: c.find("img").first().attr("src") ?? null,
      link: abs(ONE_EVENTS, href),
      fights: [],
      isToday: false,
      source: "scrape",
    });
  });
  return out;
}

// --- PFL --------------------------------------------------------------------

/**
 * PFL prints "Fri, Oct 2" with no year. Anything that lands more than two
 * months in the past is assumed to be next year's date.
 */
export function parsePflDate(text: string, now = Date.now()): number | null {
  const m = clean(text).match(/([A-Za-z]{3,9})\s+(\d{1,2})/);
  if (!m) return null;
  const year = new Date(now).getUTCFullYear();
  const t = Date.parse(`${m[1]} ${m[2]}, ${year} 18:00:00 GMT`);
  if (!Number.isFinite(t)) return null;
  const twoMonths = 60 * 86_400_000;
  return t < now - twoMonths ? Date.parse(`${m[1]} ${m[2]}, ${year + 1} 18:00:00 GMT`) : t;
}

export function parsePflEvents(html: string, now = Date.now()): FightCard[] {
  const $ = load(html);
  const out: FightCard[] = [];
  // Only the "upcoming" tab pane; the page also ships every past event.
  $("#nav-upcoming .event-hub").each((_, el) => {
    const c = $(el);
    const info = c.find(".event-card-info").first();
    const name = clean(info.find("h3").first().text());
    if (!name) return;
    const href = info.find("a").first().attr("href") ?? PFL_EVENTS;
    const location = clean(info.find("p").first().text());
    out.push({
      id: `pfl:${href.replace(/\/$/, "").split("/").pop()}`,
      promotion: "PFL",
      name,
      startsAt: parsePflDate(info.find("h6").first().text(), now),
      venue: location.split(",")[0] ?? "",
      location,
      posterUrl: c.find("img.event-hub-bg").first().attr("src") ?? null,
      link: abs(PFL_EVENTS, href),
      fights: [],
      isToday: false,
      source: "scrape",
    });
  });
  return out;
}

// --- assembly ---------------------------------------------------------------

export function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * Upcoming only, soonest first, with today's events flagged. Manual cards from
 * config override a scraped card of the same id, which is the escape hatch when
 * a promotion changes its markup.
 */
/**
 * Applies the parts that depend on the clock: what has finished, what is on
 * right now, and what counts as today.
 *
 * This runs on every state build rather than at scrape time. The scrape is
 * hourly, so anything decided there is stale within the hour — an event that
 * ended at midnight stayed flagged as "today" and kept the panel pinned to it,
 * which is exactly the bug this fixes.
 */
export function freshenCards(cards: FightCard[], now = Date.now()): FightCard[] {
  return cards
    .filter((c) => c.startsAt === null || now < c.startsAt + CARD_RUNTIME_MS)
    .map((c) => {
      const started = c.startsAt !== null && now >= c.startsAt;
      const finished = c.startsAt !== null && now >= c.startsAt + CARD_RUNTIME_MS;
      return {
        ...c,
        live: started && !finished,
        isToday: c.startsAt !== null && !finished && sameLocalDay(c.startsAt, now),
      };
    })
    .sort((a, b) => (a.startsAt ?? Infinity) - (b.startsAt ?? Infinity))
    .slice(0, 12);
}

export function assemble(cards: FightCard[], manual: FightCard[], now = Date.now()): FightCard[] {
  const byId = new Map<string, FightCard>();
  for (const c of cards) byId.set(c.id, c);
  for (const m of manual) byId.set(m.id, { ...m, source: "manual" });

  return freshenCards([...byId.values()], now);
}

export async function ingestFights(): Promise<number> {
  const cfg = loadConfig();
  const now = Date.now();

  const [ufcHtml, oneHtml, pflHtml] = await Promise.all([
    fetchText("fights.ufc", UFC_EVENTS, 30000),
    fetchText("fights.one", ONE_EVENTS, 30000),
    fetchText("fights.pfl", PFL_EVENTS, 30000),
  ]);

  // Each parser is isolated: a markup change in one promotion must not remove
  // the other two from the panel.
  const safe = <T>(fn: () => T[], id: string): T[] => {
    try {
      return fn();
    } catch (err) {
      console.error(`[fights] ${id} parse failed:`, err);
      return [];
    }
  };

  const cards = [
    ...(ufcHtml ? safe(() => parseUfcEvents(ufcHtml), "ufc") : []),
    ...(oneHtml ? safe(() => parseOneEvents(oneHtml), "one") : []),
    ...(pflHtml ? safe(() => parsePflEvents(pflHtml, now), "pfl") : []),
  ];

  const assembled = assemble(cards, cfg.manualFightCards, now);

  // Only today's UFC card justifies the extra page fetch for bout order.
  const today = assembled.find((c) => c.isToday && c.promotion === "UFC" && c.source === "scrape");
  if (today) {
    const page = await fetchText("fights.ufc.card", today.link, 30000);
    if (page) today.fights = safe(() => parseUfcCard(page), "ufc-card");
  }

  putBlob("fights", assembled);
  return assembled.length;
}
