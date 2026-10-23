import { getBlob, noteAttempt, noteFailure, noteSuccess, putBlob } from "../db";
import { fetchText } from "../http";
import { printablesThumb, sellableLicense } from "../business";

/**
 * Live ideas for the catalogue.
 *
 *   - What makers are printing this week: Printables' public API ordered by
 *     likes over the last seven days, with each model's licence, because a
 *     non-commercial model is an idea, not a product you can sell.
 *   - What Canada is searching for today: Google Trends' daily feed. A movie,
 *     a team, a game in the news is a print people will want this week.
 */

const KEY = "business.ideas";
const PRINTABLES = "https://api.printables.com/graphql/";

export interface TrendingModel {
  id: string;
  name: string;
  url: string;
  image: string | null;
  likes: number;
  downloads: number;
  category: string;
  license: string;
  /** The licence allows selling prints. */
  sellable: boolean;
  published: number | null;
}

export interface TrendingSearch {
  query: string;
  /** "50K+", as Google words it. */
  traffic: string;
  /** A headline explaining why it is trending, when Google gives one. */
  context: string;
}

interface RawPrint {
  id?: string;
  name?: string;
  slug?: string;
  likesCount?: number;
  downloadCount?: number;
  datePublished?: string;
  image?: { filePath?: string } | null;
  category?: { name?: string } | null;
  license?: { name?: string; abbreviation?: string } | null;
}

export function toTrendingModel(p: RawPrint): TrendingModel | null {
  if (!p.id || !p.name) return null;
  const license = p.license?.abbreviation || p.license?.name || "";
  const when = Date.parse(p.datePublished ?? "");
  return {
    id: p.id,
    name: p.name,
    url: `https://www.printables.com/model/${p.id}${p.slug ? `-${p.slug}` : ""}`,
    image: printablesThumb(p.image?.filePath),
    likes: p.likesCount ?? 0,
    downloads: p.downloadCount ?? 0,
    category: p.category?.name ?? "",
    license,
    sellable: sellableLicense(`${license} ${p.license?.name ?? ""}`),
    published: Number.isFinite(when) ? when : null,
  };
}

/** Google Trends' daily RSS: each item is a search, with traffic and a news headline. */
export function parseTrends(xml: string): TrendingSearch[] {
  const out: TrendingSearch[] = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const get = (tag: string) =>
      (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block)?.[1] ?? "")
        .replace(/<!\[CDATA\[|\]\]>/g, "")
        .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .trim();
    const query = get("title");
    if (!query) continue;
    out.push({ query, traffic: get("ht:approx_traffic"), context: get("ht:news_item_title") });
  }
  return out;
}

async function printablesTrending(): Promise<TrendingModel[]> {
  const source = "ideas.printables";
  noteAttempt(source);
  const started = Date.now();
  try {
    const res = await fetch(PRINTABLES, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": "en-CA,en;q=0.9",
        // Printables turns away bare server requests; these are what its own site sends.
        Origin: "https://www.printables.com",
        Referer: "https://www.printables.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        // Printables throttles by query size: 40 models with dates and categories
        // gets "Request was throttled"; 24 with just what the panel shows does not.
        query: `{ morePrints(limit: 24, ordering: "-likes_count_7_days") { items { id name slug likesCount downloadCount image { filePath } license { name abbreviation } } } }`,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      noteFailure(source, `HTTP ${res.status}`);
      return [];
    }
    const text = await res.text();
    noteSuccess(source, Date.now() - started, text.length);
    const items = (JSON.parse(text) as { data?: { morePrints?: { items?: RawPrint[] } } }).data?.morePrints?.items ?? [];
    return items.map(toTrendingModel).filter((m): m is TrendingModel => m !== null);
  } catch (err) {
    noteFailure(source, err instanceof Error ? err.message : String(err));
    return [];
  }
}

export async function ingestIdeas(): Promise<number> {
  const [models, trendsXml] = await Promise.all([
    printablesTrending(),
    fetchText("ideas.trends", "https://trends.google.com/trending/rss?geo=CA", 15_000),
  ]);
  const prev = getBlob<{ models: TrendingModel[]; trends: TrendingSearch[] }>(KEY)?.value;
  const trends = trendsXml ? parseTrends(trendsXml) : [];
  // Keep the last good copy of whichever half failed.
  putBlob(KEY, {
    models: models.length ? models : (prev?.models ?? []),
    trends: trends.length ? trends : (prev?.trends ?? []),
  });
  return models.length + trends.length;
}

export function getIdeas(): { models: TrendingModel[]; trends: TrendingSearch[] } {
  return getBlob<{ models: TrendingModel[]; trends: TrendingSearch[] }>(KEY)?.value ?? { models: [], trends: [] };
}
