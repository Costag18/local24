import { printerFrame } from "@/lib/printer";

export const dynamic = "force-dynamic";

/**
 * The latest camera frame as a plain JPEG.
 *
 * Asking is also what keeps the camera connection open; with no requests for
 * a little while the server hangs up. No frame yet answers 204, with the
 * camera's state in a header so the page can say why.
 */
export async function GET() {
  const { jpg, at, state } = printerFrame();
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
