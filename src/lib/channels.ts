import type { Channel } from "./types";

export type ChannelKind = Channel["type"];

export interface ParsedRef {
  type: ChannelKind;
  ref: string;
  /** False when the input cannot be turned into something embeddable. */
  embeddable: boolean;
}

/**
 * Accepts whatever the user pastes — a watch URL, a playlist URL, a channel
 * URL, a bare id, an @handle, or a direct stream URL — and works out how to
 * play it. Handles cannot be embedded (YouTube needs a channel id and there is
 * no reliable way to resolve one from here), so they are marked non-embeddable
 * and the pane offers the watch link instead of a black rectangle.
 */
export function parseChannelRef(input: string): ParsedRef {
  const raw = input.trim();
  if (!raw) return { type: "youtube", ref: "", embeddable: false };
  // Several sources mixed into one: resolved to a video list by the server.
  if (mixSources(raw)) return { type: "youtube", ref: raw, embeddable: true };

  // Non-YouTube media: play it directly.
  if (/^https?:\/\//i.test(raw) && !/(?:youtube\.com|youtu\.be)/i.test(raw)) {
    return { type: raw.includes(".m3u8") ? "hls" : "file", ref: raw, embeddable: true };
  }
  if (/^file:\/\//i.test(raw) || /^[a-z]:[\\/]/i.test(raw)) {
    return { type: "file", ref: raw, embeddable: true };
  }

  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { type: "youtube", ref: raw, embeddable: false };
    }
    const path = url.pathname;
    const list = url.searchParams.get("list");
    const v = url.searchParams.get("v");

    if (list) return { type: "youtube", ref: list, embeddable: true };
    if (v) return { type: "youtube", ref: v, embeddable: true };
    const channelId = path.match(/\/channel\/(UC[\w-]+)/i)?.[1];
    if (channelId) {
      // A channel URL ending in /live means "whatever is streaming now".
      const live = /\/live\/?$/i.test(path);
      return { type: live ? "youtube-live" : "youtube", ref: channelId, embeddable: true };
    }
    if (url.hostname === "youtu.be") {
      const id = path.replace(/^\//, "");
      return { type: "youtube", ref: id, embeddable: Boolean(id) };
    }
    if (/^\/@[\w.-]+/.test(path)) {
      return { type: "youtube", ref: raw, embeddable: false }; // handle: link only
    }
    if (/^\/embed\/([\w-]+)/.test(path)) {
      return { type: "youtube", ref: path.match(/^\/embed\/([\w-]+)/)?.[1] ?? "", embeddable: true };
    }
    return { type: "youtube", ref: raw, embeddable: false };
  }

  if (raw.startsWith("@")) return { type: "youtube", ref: `https://www.youtube.com/${raw}`, embeddable: false };
  // A bare channel id is ambiguous, so it means "this channel's uploads".
  // Pasting the channel's /live URL is how you opt into a livestream.
  if (/^UC[\w-]{20,}$/.test(raw)) return { type: "youtube", ref: raw, embeddable: true };
  if (/^(PL|UU|LL|FL)[\w-]+$/.test(raw)) return { type: "youtube", ref: raw, embeddable: true };
  if (/^[\w-]{11}$/.test(raw)) return { type: "youtube", ref: raw, embeddable: true }; // video id

  return { type: "youtube", ref: raw, embeddable: false };
}

/**
 * Sources separated by commas mean one channel that plays them all mixed
 * together. Each is a channel id (UC…, meaning that creator's uploads) or a
 * playlist id (PL…/UU…) — e.g. "UCaaa…, PLbbb…" is one creator's videos plus
 * one of another creator's playlists. Null for anything else, including a
 * single id, which plays on its own as before.
 */
export function mixSources(ref: string): string[] | null {
  const parts = ref.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || !parts.every((p) => /^(UC[\w-]{20,}|(PL|UU)[\w-]{10,})$/.test(p))) return null;
  return [...new Set(parts)];
}

/** The most videos named in one embed URL; past this the URL gets unwieldy. */
export const MIX_LIMIT = 150;

/**
 * Shuffles each source's videos, then deals them out in turn, so the mix
 * alternates between creators instead of playing one through and then the
 * other. A creator with fewer videos simply runs out sooner.
 */
export function interleave(lists: string[][], limit = MIX_LIMIT, rand: () => number = Math.random): string[] {
  const decks = lists.map((l) => {
    const d = [...new Set(l)];
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (let round = 0; out.length < limit; round++) {
    let dealt = false;
    for (const d of decks) {
      if (round >= d.length) continue;
      dealt = true;
      if (seen.has(d[round])) continue;
      seen.add(d[round]);
      out.push(d[round]);
      if (out.length >= limit) break;
    }
    if (!dealt) break;
  }
  return out;
}

/**
 * The video ids on a playlist page, in order.
 *
 * Current pages mark each entry with `lockupViewModel`/`contentId`; older ones
 * used `playlistVideoRenderer`. Both are read, so a layout change on
 * YouTube's side degrades to the other rather than to nothing.
 */
export function playlistIds(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/"contentId":"([\w-]{11})"/g)) out.add(m[1]);
  for (const m of html.matchAll(/"playlistVideoRenderer":\{"videoId":"([\w-]{11})"/g)) out.add(m[1]);
  return [...out];
}

/** An embed that plays exactly these videos in order, looping. */
export function mixEmbedUrl(ids: string[]): string | null {
  if (!ids.length) return null;
  return `https://www.youtube.com/embed/${ids[0]}?${COMMON}&loop=1&playlist=${ids.join(",")}`;
}

// `controls=0` removes YouTube's own chrome; the pane covers the frame anyway
// so nothing of theirs can be hovered. `enablejsapi=1` is what lets the
// dashboard's volume control talk to the player over postMessage.
const COMMON =
  "autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&enablejsapi=1";

/**
 * A channel id (UC…) has no direct "play this channel" embed, but its uploads
 * playlist is the same id with the prefix swapped to UU — which does embed.
 */
export function embedUrl(ch: Channel): string | null {
  const parsed = parseChannelRef(ch.ref);
  if (!parsed.embeddable) return null;

  switch (parsed.type) {
    case "youtube-live":
      return `https://www.youtube.com/embed/live_stream?channel=${parsed.ref}&${COMMON}`;
    case "youtube": {
      const r = parsed.ref;
      // A mix has no single embed; the pane asks the server for its videos.
      if (mixSources(r)) return null;
      if (/^(PL|UU|LL|FL)[\w-]+$/.test(r))
        return `https://www.youtube.com/embed/videoseries?list=${r}&${COMMON}&loop=1`;
      if (/^UC[\w-]{20,}$/.test(r))
        return `https://www.youtube.com/embed/videoseries?list=UU${r.slice(2)}&${COMMON}&loop=1`;
      // A single video only repeats if it is also named as its own playlist;
      // `loop=1` alone is ignored.
      return `https://www.youtube.com/embed/${r}?${COMMON}&loop=1&playlist=${r}`;
    }
    default:
      return parsed.ref;
  }
}

/** Where "OPEN ↗" goes, and the fallback when an embed is refused. */
export function watchUrl(ch: Channel): string {
  const raw = ch.ref.trim();
  if (!raw) return "https://www.youtube.com/";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("@")) return `https://www.youtube.com/${raw}`;
  if (/^UC[\w-]{20,}$/.test(raw)) return `https://www.youtube.com/channel/${raw}`;
  const mix = mixSources(raw);
  if (mix) {
    const first = mix[0];
    return first.startsWith("UC")
      ? `https://www.youtube.com/channel/${first}/videos`
      : `https://www.youtube.com/playlist?list=${first}`;
  }
  if (/^(PL|UU|LL|FL)[\w-]+$/.test(raw)) return `https://www.youtube.com/playlist?list=${raw}`;
  if (/^[\w-]{11}$/.test(raw)) return `https://www.youtube.com/watch?v=${raw}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(raw)}`;
}
