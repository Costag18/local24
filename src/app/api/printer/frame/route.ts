import { printerFrame } from "@/lib/printer";
import { mjpegResponse } from "@/lib/mjpeg";

export const dynamic = "force-dynamic";

/**
 * The printer camera.
 *
 * `?stream=1` is a continuous MJPEG stream — up to twenty frames a second,
 * what the printer page shows. Without it, the latest frame as a plain JPEG.
 * Asking (or staying connected to the stream) is also what keeps the camera
 * connection open; with nobody watching the server hangs up. No frame yet
 * answers 204, with the camera's state in a header so the page can say why.
 */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("stream") === "1") {
    return mjpegResponse(req, {
      fps: 20,
      next: () => {
        const f = printerFrame();
        return { jpg: f.jpg, at: f.at };
      },
    });
  }
  const { jpg, at, state } = printerFrame();
  // The page only wants to know the camera's state; the picture is streamed.
  if (new URL(req.url).searchParams.get("peek") === "1") {
    return new Response(null, { status: 204, headers: { "x-camera-state": state, "cache-control": "no-store" } });
  }
  if (!jpg) return new Response(null, { status: 204, headers: { "x-camera-state": state, "cache-control": "no-store" } });
  return new Response(new Uint8Array(jpg), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
      "x-camera-state": state,
      "x-frame-at": String(at),
    },
  });
}
