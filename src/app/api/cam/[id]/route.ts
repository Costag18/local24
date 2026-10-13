import { NextResponse } from "next/server";
import { listCams } from "@/lib/db";
import { captureFrame, getFrame, listFrameTimes } from "@/lib/sources/cams";

export const dynamic = "force-dynamic";

/**
 * Proxying the hero camera (rather than pointing <img> straight at the source)
 * is what makes dead-feed detection and scrub-back possible: the bytes have to
 * pass through the server to be hashed and buffered. Thumbnails still load
 * direct from the source, so this cost is paid once per rotation, not 4x.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const cam = listCams().find((c) => c.id === id);
  if (!cam) return NextResponse.json({ error: "unknown camera" }, { status: 404 });

  // Frame index, for the scrub-back slider.
  if (url.searchParams.get("times") === "1") {
    return NextResponse.json({ id, times: listFrameTimes(id) });
  }

  // A specific buffered frame.
  const scrubAt = Number(url.searchParams.get("at"));
  if (Number.isFinite(scrubAt) && scrubAt > 0) {
    const buf = getFrame(id, scrubAt);
    if (!buf) return NextResponse.json({ error: "no such frame" }, { status: 404 });
    return new NextResponse(new Uint8Array(buf), {
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" },
    });
  }

  const { buf, dead, frozen, at } = await captureFrame(cam);
  if (!buf) {
    // Fall back to the newest buffered frame so a blip does not blank the hero.
    const last = getFrame(id);
    if (last) {
      return new NextResponse(new Uint8Array(last), {
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "no-store",
          "x-local24-stale": "1",
        },
      });
    }
    return NextResponse.json({ error: "camera unavailable", dead }, { status: 502 });
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
      // These cameras are snapshots, so an unchanged picture is normal. The UI
      // uses these to show real frame age instead of implying a dead feed.
      "x-local24-frozen": frozen ? "1" : "0",
      "x-local24-changed": frozen ? "0" : "1",
      "x-local24-frame-at": String(at),
    },
  });
}
