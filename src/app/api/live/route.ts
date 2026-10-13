import { NextResponse } from "next/server";
import { BROWSER_UA, fetchText } from "@/lib/http";
import { getBlob, putBlob } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Long enough to stay well clear of YouTube's rate limiting. */
const TTL_MS = 5 * 60 * 1000;

interface Resolved {
  videoId: string | null;
  live: boolean;
  at: number;
}

/**
 * Turns a channel into whatever it is streaming right now.
 *
 * `/embed/live_stream?channel=…` is the documented way to do this and it no
 * longer works — the page loads but the player answers "This video is
 * unavailable". Reading the channel's own /live page gives the real video id,
 * which embeds normally. Cached, because this runs whenever a channel is
 * selected and the watch pages 429 on back-to-back requests.
 */
export async function GET(req: Request) {
  const channel = new URL(req.url).searchParams.get("channel") ?? "";
  if (!/^UC[\w-]{20,}$/.test(channel)) {
    return NextResponse.json({ error: "not a channel id" }, { status: 400 });
  }

  const key = `live.${channel}`;
  const cached = getBlob<Resolved>(key)?.value;
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached);
  }

  const html = await fetchText(
    "live.resolve",
    `https://www.youtube.com/channel/${channel}/live`,
    20_000,
    BROWSER_UA,
  );

  // A failed lookup keeps the last known id rather than blanking the pane.
  if (!html || html.length < 20_000) {
    return NextResponse.json(cached ?? { videoId: null, live: false, at: Date.now() });
  }

  const resolved: Resolved = {
    videoId: html.match(/"videoId":"([\w-]{11})"/)?.[1] ?? null,
    live: /"isLive":true/.test(html),
    at: Date.now(),
  };
  putBlob(key, resolved);
  return NextResponse.json(resolved);
}
