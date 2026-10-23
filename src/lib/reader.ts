/**
 * Turns a news page into something readable inside the dashboard.
 *
 * Clicking a headline used to open the site in a new tab, and in the kiosk
 * window there is no tab strip or back button, so there was no way back. The
 * reader shows the story in an overlay instead: title, picture and the text
 * itself, pulled out of the page here with no dependencies.
 *
 * Two ways in, best first: the structured data most news sites embed for
 * search engines (`articleBody` in JSON-LD), then the page's own paragraphs
 * inside its <article>. Navigation, ads and "sign up for our newsletter"
 * lines are left behind.
 */

export interface Article {
  url: string;
  title: string;
  site: string;
  image: string | null;
  /** Epoch ms, when the page says. */
  published: number | null;
  description: string;
  blocks: { kind: "p" | "h"; text: string }[];
  /** A list of further pages (search results), shown as cards that open in the reader. */
  links?: { title: string; url: string; image: string | null; note: string }[];
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•", middot: "·",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Tags out, entities decoded, whitespace collapsed. */
export function plainText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, keys: string[]): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = content?.[1] ?? content?.[2];
    if (value) return decodeEntities(value).trim();
  }
  return "";
}

/** The longest `articleBody` in the page's JSON-LD, if any. */
function jsonLdBody(html: string): string {
  let best = "";
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(visit);
    const o = v as Record<string, unknown>;
    if (typeof o.articleBody === "string" && o.articleBody.length > best.length) best = o.articleBody;
    Object.values(o).forEach(visit);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      /* some sites ship invalid JSON-LD; skip it */
    }
  }
  return best;
}

/** Short lines that are page furniture rather than the story. */
const BOILERPLATE =
  /\b(subscribe|newsletter|sign up|sign in|log in|advertisement|cookies?|all rights reserved|follow us|share this|related:|read more|click here|download (our|the) app|terms of (use|service)|privacy policy)\b/i;

function cleanBlocks(blocks: Article["blocks"]): Article["blocks"] {
  const seen = new Set<string>();
  const out: Article["blocks"] = [];
  for (const b of blocks) {
    if (!b.text || seen.has(b.text)) continue;
    if (b.text.length < 160 && BOILERPLATE.test(b.text)) continue;
    seen.add(b.text);
    out.push(b);
    if (out.length >= 80) break;
  }
  // A heading with nothing after it is a stray section label.
  while (out.length && out[out.length - 1].kind === "h") out.pop();
  return out;
}

/** The part of the page most likely to be the story. */
function storyRegion(html: string): string {
  const stripped = html.replace(
    /<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|figure|button|template)\b[\s\S]*?<\/\1>/gi,
    " ",
  );
  const articles = [...stripped.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((m) => m[1]);
  if (articles.length) return articles.sort((a, b) => b.length - a.length)[0];
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(stripped)?.[1];
  return main ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(stripped)?.[1] ?? stripped;
}

function htmlBlocks(region: string): Article["blocks"] {
  const blocks: Article["blocks"] = [];
  for (const m of region.matchAll(/<(p|h2|h3|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = plainText(m[2]);
    const tag = m[1].toLowerCase();
    if (tag === "h2" || tag === "h3") {
      if (text.length >= 3 && text.length <= 120) blocks.push({ kind: "h", text });
    } else if (text.length >= 40 || (text.length >= 20 && /[.!?"”]$/.test(text))) {
      blocks.push({ kind: "p", text });
    }
  }
  return blocks;
}

function bodyBlocks(body: string): Article["blocks"] {
  const text = decodeEntities(body).replace(/\r/g, "");
  const parts = text.includes("\n") ? text.split(/\n+/) : text.split(/(?<=[.!?”"])\s{2,}/);
  return parts.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.length > 1).map((t) => ({ kind: "p" as const, text: t }));
}

export function extractArticle(html: string, url: string): Article {
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ||
    plainText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") ||
    url;
  let site = metaContent(html, ["og:site_name", "application-name"]);
  if (!site) {
    try {
      site = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      site = "";
    }
  }
  const rawImage = metaContent(html, ["og:image", "og:image:url", "twitter:image"]);
  let image: string | null = null;
  try {
    image = rawImage ? new URL(rawImage, url).toString() : null;
  } catch {
    image = null;
  }
  const when = Date.parse(metaContent(html, ["article:published_time", "datepublished", "date", "pubdate"]));

  const fromHtml = cleanBlocks(htmlBlocks(storyRegion(html)));
  const ld = jsonLdBody(html);
  const fromLd = ld ? cleanBlocks(bodyBlocks(ld)) : [];
  const words = (b: Article["blocks"]) => b.reduce((n, x) => n + x.text.length, 0);
  // Structured data is cleaner, but some sites truncate it to a teaser.
  const blocks = words(fromLd) >= Math.max(400, words(fromHtml) * 0.6) ? fromLd : fromHtml;

  return {
    url,
    title,
    site,
    image,
    published: Number.isFinite(when) ? when : null,
    description: metaContent(html, ["og:description", "description", "twitter:description"]),
    blocks,
  };
}

/**
 * Only public web pages. The reader runs on the dashboard's server, which
 * anyone on the home network can reach, so it must not become a way to read
 * the router's admin page or the printer.
 */
export function isPublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") || host.includes(":")) return false; // bare names, IPv6
  if (/\.(local|lan|home|internal|localhost|arpa)$/.test(host)) return false;
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

/** A YouTube video id from a watch, short or live link. */
export function youtubeId(raw: string): string | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1) || null;
    if (host !== "youtube.com") return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    return /^\/(?:live|shorts|embed)\/([\w-]{6,})/.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
