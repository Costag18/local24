import { getBlob, noteAttempt, noteFailure, noteSuccess, putBlob } from "../db";
import { loadConfig } from "../config";
import { distanceKm } from "./cams";
import type { AppConfig, Listing } from "../types";

/**
 * New local listings for the things you are watching for: video games, 3D
 * printers, filament. Three marketplaces, all read logged out, so no account
 * is involved:
 *
 *   - Facebook Marketplace: its search page carries the results as JSON for
 *     the page's own scripts, with a posting time. It ignores a radius when
 *     logged out and returns half of Ontario, so results are kept by city.
 *   - Kijiji: a Next.js page with every listing in `__NEXT_DATA__`, including
 *     coordinates, so distance from home is exact.
 *   - Karrot: a Remix page with listings in `__remixContext`. No dates, so a
 *     listing counts as new from the moment it is first seen.
 *
 * Search terms are broad and marketplaces pad results, so every title must
 * also match the search's own pattern — a "3d printer" search otherwise
 * returns Hot Wheels towers and 3D-printed fidget toys.
 */

const KEY = "market";
/** A listing older than this has stopped being news. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_KEPT = 300;

type Search = AppConfig["market"]["searches"][number];
type Found = Omit<Listing, "firstSeen" | "search">;

/** What a real Chrome sends; Facebook answers anything less with a 400. */
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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

async function page(source: string, url: string): Promise<string | null> {
  noteAttempt(source);
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      noteFailure(source, `HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    noteSuccess(source, Date.now() - started, Buffer.byteLength(text));
    return text;
  } catch (err) {
    noteFailure(source, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Every object in a JSON tree that `pick` accepts, without descending into it. */
function collect<T>(root: unknown, pick: (o: Record<string, unknown>) => boolean): T[] {
  const out: T[] = [];
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(visit);
    const o = v as Record<string, unknown>;
    if (pick(o)) {
      out.push(o as T);
      return;
    }
    Object.values(o).forEach(visit);
  };
  visit(root);
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const money = (n: number) => (n === 0 ? "Free" : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);

// --- Facebook ---------------------------------------------------------------

export function parseFacebook(html: string): (Found & { city: string })[] {
  const out: (Found & { city: string })[] = [];
  for (const m of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!m[1].includes("marketplace_listing_title")) continue;
    let json: unknown;
    try {
      json = JSON.parse(m[1]);
    } catch {
      continue;
    }
    for (const l of collect<Record<string, unknown>>(json, (o) => typeof o.marketplace_listing_title === "string")) {
      if (l.is_sold || l.is_pending || l.is_hidden) continue;
      const price = l.listing_price as { amount?: string } | undefined;
      const amount = Number(price?.amount);
      const geo = (l.location as { reverse_geocode?: { city?: string; state?: string } } | undefined)?.reverse_geocode;
      const photo = (l.primary_listing_photo as { image?: { uri?: string } } | undefined)?.image?.uri;
      const created = Number(l.creation_time);
      out.push({
        id: `fb:${str(l.id)}`,
        source: "facebook",
        title: str(l.marketplace_listing_title).trim(),
        price: Number.isFinite(amount) ? money(amount) : "",
        place: [geo?.city, geo?.state].filter(Boolean).join(", "),
        city: geo?.city ?? "",
        image: photo ?? null,
        url: `https://www.facebook.com/marketplace/item/${str(l.id)}/`,
        postedAt: Number.isFinite(created) && created > 0 ? created * 1000 : null,
      });
    }
  }
  return out;
}

// --- Kijiji -----------------------------------------------------------------

export function parseKijiji(html: string): (Found & { lat: number | null; lon: number | null })[] {
  const raw = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  return collect<Record<string, unknown>>(json, (o) => o.__typename === "StandardListing").map((l) => {
    const price = l.price as { amount?: number; type?: string } | undefined;
    const loc = l.location as { name?: string; address?: string; coordinates?: { latitude?: number; longitude?: number } } | undefined;
    // Kijiji's own "newest" order: a relisted item counts from its relisting.
    const when = Date.parse(str(l.sortingDate) || str(l.activationDate));
    const cents = Number(price?.amount);
    const area = str(loc?.address).split(",").slice(-2, -1)[0]?.trim() || str(loc?.name);
    return {
      id: `kj:${str(l.id)}`,
      source: "kijiji" as const,
      title: str(l.title).trim(),
      price: price?.type === "FREE" ? "Free" : Number.isFinite(cents) && cents > 0 ? money(cents / 100) : "",
      place: area,
      image: (l.imageUrls as string[] | undefined)?.[0] ?? null,
      url: str(l.url),
      postedAt: Number.isFinite(when) ? when : null,
      lat: loc?.coordinates?.latitude ?? null,
      lon: loc?.coordinates?.longitude ?? null,
    };
  });
}

// --- Karrot -----------------------------------------------------------------

export function parseKarrot(html: string): (Found & { km: number | null })[] {
  const raw = /window\.__remixContext\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html)?.[1];
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  return collect<Record<string, unknown>>(json, (o) => typeof o.title === "string" && "price" in o && "nodeId" in o)
    .filter((l) => l.status === "ongoing" && !seen.has(str(l.nodeId)) && seen.add(str(l.nodeId)))
    .map((l) => {
      const amount = Number(l.price);
      const km = Number(/([\d.]+)\s*km/.exec(str(l.relativeDistanceDescription))?.[1]);
      return {
        id: `kr:${str(l.nodeId)}`,
        source: "karrot" as const,
        title: str(l.title).trim(),
        price: str(l.priceDescription) || (Number.isFinite(amount) ? money(amount) : ""),
        place: str(l.displayLocationName),
        image: str(l.thumbnail) || null,
        url: `https://www.karrotmarket.com/ca/buy-sell/${str(l.nodeId)}/`,
        postedAt: null,
        km: Number.isFinite(km) ? km : null,
      };
    });
}

// --- Filtering and merging --------------------------------------------------

/** "Looking for…" posts are requests, not things for sale. */
const WANTED = /^\s*(looking for|wanted|wtb|iso\b|in search of|buying\b)/i;

/** Whether a title belongs in a search: matches its pattern and none of its exclusions. */
export function relevant(title: string, s: Pick<Search, "match" | "exclude">): boolean {
  if (!title || WANTED.test(title)) return false;
  try {
    if (s.match && !new RegExp(s.match, "i").test(title)) return false;
    if (s.exclude && new RegExp(s.exclude, "i").test(title)) return false;
  } catch {
    /* a bad pattern typed into Settings must not empty the panel */
  }
  return true;
}

/**
 * Folds a fresh batch into what is stored. Each listing keeps the time it was
 * first seen; one without a posting date sorts by that. On the very first
 * fetch from a source nothing is genuinely new, so undated listings are
 * backdated a day rather than all claiming to be "just listed".
 */
export function mergeListings(stored: Listing[], batch: Listing[], now: number): Listing[] {
  const byId = new Map(stored.map((l) => [l.id, l]));
  const known = new Set(stored.map((l) => `${l.source}|${l.search}`));
  for (const l of batch) {
    const prev = byId.get(l.id);
    const firstRun = !known.has(`${l.source}|${l.search}`);
    byId.set(l.id, {
      ...l,
      firstSeen: prev?.firstSeen ?? (l.postedAt === null && firstRun ? now - 24 * 60 * 60 * 1000 : now),
    });
  }
  return [...byId.values()]
    .filter((l) => now - listedAt(l) < KEEP_MS)
    .sort((a, b) => listedAt(b) - listedAt(a))
    .slice(0, MAX_KEPT);
}

export function listedAt(l: Pick<Listing, "postedAt" | "firstSeen">): number {
  return l.postedAt ?? l.firstSeen;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One pass over every search on every marketplace. Requests are spaced out:
 * this is a handful of page loads every twenty minutes, about what a person
 * refreshing the tab would do.
 */
export async function ingestMarket(): Promise<number> {
  const cfg = loadConfig();
  const m = cfg.market;
  if (!m.enabled || !m.searches.length) return 0;
  const cities = new Set(m.cities.map((c) => c.toLowerCase()));
  const batch: Listing[] = [];

  for (const s of m.searches) {
    for (const q of s.queries) {
      const enc = encodeURIComponent(q);
      if (m.sources.includes("facebook")) {
        const html = await page("market.facebook", `https://www.facebook.com/marketplace/toronto/search/?query=${enc}&sortBy=creation_time_descend`);
        for (const l of html ? parseFacebook(html) : []) {
          if (!cities.has(l.city.toLowerCase()) || !relevant(l.title, s)) continue;
          batch.push({ ...strip(l), search: s.id, firstSeen: 0 });
        }
        await wait(2500);
      }
      if (m.sources.includes("kijiji")) {
        const slug = q.trim().toLowerCase().replace(/\s+/g, "-");
        const html = await page("market.kijiji", `https://www.kijiji.ca/b-city-of-toronto/${encodeURIComponent(slug)}/k0l1700273?sort=dateDesc`);
        for (const l of html ? parseKijiji(html) : []) {
          const far = l.lat !== null && l.lon !== null && distanceKm(cfg.home.lat, cfg.home.lon, l.lat, l.lon) > m.radiusKm;
          if (far || !relevant(l.title, s)) continue;
          batch.push({ ...strip(l), search: s.id, firstSeen: 0 });
        }
        await wait(2500);
      }
      if (m.sources.includes("karrot")) {
        const html = await page("market.karrot", `https://www.karrotmarket.com/ca/buy-sell/all/?search=${enc}`);
        for (const l of html ? parseKarrot(html) : []) {
          if ((l.km !== null && l.km > m.radiusKm) || !relevant(l.title, s)) continue;
          batch.push({ ...strip(l), search: s.id, firstSeen: 0 });
        }
        await wait(2500);
      }
    }
  }

  const now = Date.now();
  // Searches removed in Settings take their listings with them.
  const ids = new Set(m.searches.map((s) => s.id));
  const stored = (getBlob<Listing[]>(KEY)?.value ?? []).filter((l) => ids.has(l.search));
  const merged = mergeListings(stored, batch, now);
  putBlob(KEY, merged);
  return merged.length;
}

/** Drops the fields only used for filtering. */
function strip<T extends Found>(l: T): Found {
  return {
    id: l.id, source: l.source, title: l.title, price: l.price, place: l.place,
    image: l.image, url: l.url, postedAt: l.postedAt,
  };
}

/**
 * What the panel shows: the newest from every search, not just the busiest.
 * Video games outnumber filament ten to one, so a plain newest-first cut was
 * all games. Each search gets an equal share, then they are merged by date.
 */
export function balanceListings(all: Listing[], limit = 60): Listing[] {
  const bySearch = new Map<string, Listing[]>();
  for (const l of all) bySearch.set(l.search, [...(bySearch.get(l.search) ?? []), l]);
  const share = Math.ceil(limit / Math.max(1, bySearch.size));
  const picked = [...bySearch.values()].flatMap((list) => list.slice(0, share));
  return picked.sort((a, b) => listedAt(b) - listedAt(a)).slice(0, limit);
}

export function getListings(limit = 60): Listing[] {
  return balanceListings(getBlob<Listing[]>(KEY)?.value ?? [], limit);
}
