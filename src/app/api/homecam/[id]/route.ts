import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { withCredentials } from "@/lib/homecam";
import { ensureBridge, getNestFrame } from "@/lib/nest/bridge";

export const dynamic = "force-dynamic";

/**
 * Proxies a camera on the local network.
 *
 * Going through the server keeps any credentials out of the browser, avoids
 * mixed-content and CORS problems with a plain-HTTP camera, and means the page
 * only ever talks to localhost. An MJPEG response is piped through unchanged so
 * it keeps streaming; a snapshot is returned as one image.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const cam = loadConfig().homeCams.find((c) => c.id === id);
  if (!cam || !cam.url.trim()) {
    return NextResponse.json({ error: "unknown camera" }, { status: 404 });
  }

  // A Nest camera has no URL to fetch: the bridge has already captured a frame
  // from the signed-in browser window, so it is served straight from memory.
  if (cam.kind === "nest") {
    const frame = getNestFrame(id);
    if (!frame) {
      // Nothing yet: either it is still starting, or the machine rebooted and
      // the browser needs bringing back up.
      ensureBridge();
      return NextResponse.json({ error: "no frame captured yet" }, { status: 503 });
    }
    return new NextResponse(new Uint8Array(frame.buf), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
        // How old the frame is, so the panel can say when one goes stale
        // rather than showing a still picture that looks live.
        "x-frame-age-ms": String(Date.now() - frame.at),
      },
    });
  }

  const { url, headers } = withCredentials(cam.url.trim());
  const ctrl = new AbortController();
  // A stream should not be cut off; a still should not hang the panel.
  const timeout = cam.kind === "mjpeg" ? null : setTimeout(() => ctrl.abort(), 12_000);
  req.signal.addEventListener("abort", () => ctrl.abort());

  try {
    const res = await fetch(url, {
      headers: { ...headers, accept: "image/*,*/*" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `camera returned ${res.status}` }, { status: 502 });
    }

    return new NextResponse(res.body, {
      headers: {
        "content-type": res.headers.get("content-type") ?? "image/jpeg",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "camera unreachable" },
      { status: 502 },
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
