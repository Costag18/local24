import { extractArticle, type Article } from "./reader";
import { printablesThumb, sellableLicense } from "./business";

/**
 * Printables pages for the in-dashboard reader.
 *
 * printables.com sits behind a bot challenge, so fetching its pages gets a
 * "checking your browser" screen. Its public API answers, though, so a model
 * link or a model search is rebuilt from the API: the model's photo, its
 * description, how popular it is and — the thing that matters for a shop —
 * whether its licence allows selling prints.
 */

const API = "https://api.printables.com/graphql/";

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: "https://www.printables.com",
        Referer: "https://www.printables.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data?: T }).data ?? null;
  } catch {
    return null;
  }
}

const media = (p?: string | null) => (p ? `https://media.printables.com/${p}` : null);

/** A Printables model or search URL, or null if it is neither. */
export function printablesTarget(url: string): { kind: "model"; id: string } | { kind: "search"; q: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)printables\.com$/.test(u.hostname)) return null;
  const model = /^\/model\/(\d+)/.exec(u.pathname);
  if (model) return { kind: "model", id: model[1] };
  if (u.pathname.startsWith("/search")) {
    const q = u.searchParams.get("q")?.trim();
    if (q) return { kind: "search", q: q.slice(0, 100) };
  }
  return null;
}

export async function printablesArticle(url: string): Promise<Article | null> {
  const t = printablesTarget(url);
  if (!t) return null;

  if (t.kind === "model") {
    const data = await gql<{ print?: {
      name?: string; summary?: string; description?: string; likesCount?: number; downloadCount?: number;
      images?: { filePath?: string }[]; user?: { publicUsername?: string }; license?: { name?: string; abbreviation?: string };
    } }>(
      "query($id:ID!){ print(id:$id){ name summary description likesCount downloadCount images { filePath } user { publicUsername } license { name abbreviation } } }",
      { id: t.id },
    );
    const p = data?.print;
    if (!p?.name) return null;
    const license = p.license?.abbreviation || p.license?.name || "no licence listed";
    const sellable = sellableLicense(`${license} ${p.license?.name ?? ""}`);
    // Reuse the page extractor on the description, which is HTML.
    const body = extractArticle(`<html><body><article>${p.description ?? ""}</article></body></html>`, url);
    return {
      url,
      title: p.name,
      site: `Printables${p.user?.publicUsername ? ` · ${p.user.publicUsername}` : ""}`,
      image: media(p.images?.[0]?.filePath),
      published: null,
      description: p.summary ?? "",
      blocks: [
        {
          kind: "h",
          text: `${sellable ? "OK to sell prints" : "Personal use only, not for sale"} (${license})`,
        },
        { kind: "p", text: `♥ ${(p.likesCount ?? 0).toLocaleString()} likes · ${(p.downloadCount ?? 0).toLocaleString()} downloads` },
        ...(p.summary ? [{ kind: "p" as const, text: p.summary }] : []),
        ...body.blocks,
      ],
    };
  }

  const data = await gql<{ searchPrints2?: { items?: { id?: string; name?: string; slug?: string; likesCount?: number; image?: { filePath?: string } | null; license?: { name?: string; abbreviation?: string } | null }[] } }>(
    "query($q:String!){ searchPrints2(query:$q, limit:24){ items { id name slug likesCount image { filePath } license { name abbreviation } } } }",
    { q: t.q },
  );
  const items = data?.searchPrints2?.items ?? [];
  const links = items
    .filter((i) => i.id && i.name)
    .map((i) => {
      const license = i.license?.abbreviation || i.license?.name || "";
      const sellable = sellableLicense(`${license} ${i.license?.name ?? ""}`);
      return {
        title: i.name as string,
        url: `https://www.printables.com/model/${i.id}${i.slug ? `-${i.slug}` : ""}`,
        image: printablesThumb(i.image?.filePath),
        note: `♥ ${(i.likesCount ?? 0).toLocaleString()} · ${sellable ? "OK to sell" : "personal use"}`,
        sellable,
      };
    })
    // Sellable first: those are the ones the shop can actually offer.
    .sort((a, b) => Number(b.sellable) - Number(a.sellable));
  return {
    url,
    title: `Models for “${t.q}”`,
    site: "Printables",
    image: null,
    published: null,
    description: links.length ? "" : "No models found for that.",
    blocks: links.length ? [{ kind: "p", text: `${links.filter((l) => l.sellable).length} of ${links.length} can be sold as prints. Tap one for details.` }] : [],
    links: links.map(({ sellable: _s, ...l }) => l),
  };
}
