import { NextResponse } from "next/server";
import { BROWSER_UA, fetchText } from "@/lib/http";
import { getBlob, putBlob } from "@/lib/db";
import { interleave, mixSources, playlistIds } from "@/lib/channels";

export const dynamic = "force-dynamic";

/** Uploads change a few times a week; there is no reason to ask more often. */
const TTL_MS = 6 * 60 * 60 * 1000;

interface Uploads {
  ids: string[];
  at: number;
}

/**
 * The videos in one source: a playlist as it stands, or a creator's uploads.
 *
 * For a channel, `UULF` + its id is YouTube's videos-only uploads list: the
 * same as `UU` but without Shorts, which are vertical and look wrong in a
 * 16:9 pane.
 */
async function videosOf(source: string): Promise<string[]> {
  const list = source.startsWith("UC") ? `UULF${source.slice(2)}` : source;
  const key = `mix.${list}`;
  const cached = getBlob<Uploads>(key)?.value;
  if (cached && cached.ids.length && Date.now() - cached.at < TTL_MS) return cached.ids;

  const html = await fetchText(
    "mix.uploads",
    `https://www.youtube.com/playlist?list=${list}`,
    20_000,
    BROWSER_UA,
  );
  const ids = html ? playlistIds(html) : [];
  // A failed fetch keeps the last good list rather than emptying the channel.
  if (!ids.length) return cached?.ids ?? [];
  putBlob(key, { ids, at: Date.now() } satisfies Uploads);
  return ids;
}

/**
 * Several sources as one channel.
 *
 * An embed can play a single list, but not two, so the server fetches each
 * source's videos and deals them together into one list of video ids, which
 * the pane plays as an ordinary playlist.
 */
export async function GET(req: Request) {
  const sources = mixSources(new URL(req.url).searchParams.get("sources") ?? "");
  if (!sources) {
    return NextResponse.json({ error: "need two or more channel or playlist ids" }, { status: 400 });
  }
  const lists = await Promise.all(sources.map(videosOf));
  return NextResponse.json({ ids: interleave(lists), counts: lists.map((l) => l.length) });
}
