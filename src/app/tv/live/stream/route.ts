import { mirrorFrame } from "@/lib/mirror";
import { mjpegResponse } from "@/lib/mjpeg";

export const dynamic = "force-dynamic";

/**
 * The mirror as one continuous MJPEG stream, up to 20 frames a second, for
 * browsers that can show one (/tv/live?stream=1). Faster than fetching
 * picture after picture, where the TV supports it.
 */
export async function GET(req: Request) {
  return mjpegResponse(req, {
    fps: 20,
    next: async () => {
      const f = await mirrorFrame();
      return { jpg: f.jpg, at: f.at };
    },
  });
}
