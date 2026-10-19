import { buildState } from "@/lib/state";
import { getBoard } from "@/lib/board";
import { printerView } from "@/lib/printer";
import { radarFrames } from "@/lib/radarFrames";
import { startPoller } from "@/lib/poller";
import { renderTv, tvPages } from "@/lib/tv";

export const dynamic = "force-dynamic";

/**
 * The TV page: http://<this computer>:3100/tv on a PS3 or any old browser.
 * See lib/tv.ts. `?p=` picks the page (it advances itself) and `?s=` sets how
 * many seconds each page holds.
 */
export async function GET(req: Request) {
  startPoller();
  const q = new URL(req.url).searchParams;
  const secs = Math.min(120, Math.max(8, Number(q.get("s")) || 20));
  const state = buildState();
  const printer = state.config.printer.host && state.config.printer.serial ? printerView() : null;
  const pages = tvPages({ state, printer });
  const page = pages[(Math.max(0, Number(q.get("p")) || 0)) % pages.length];

  const board = page === "now" ? (await getBoard()).rows : [];
  const frames = page === "radar" ? await radarFrames() : [];

  const html = renderTv({ state, board, printer, radarFrame: frames.at(-1) ?? null, now: Date.now() }, page, secs);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
