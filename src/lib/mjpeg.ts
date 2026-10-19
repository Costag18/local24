/**
 * A camera as a continuous stream (MJPEG): one long response that keeps
 * sending the next JPEG as soon as there is one. Browsers play it in a plain
 * <img>, with no polling, which is the difference between one frame a second
 * and fifteen or twenty.
 */

const BOUNDARY = "local24frame";

export interface FrameSource {
  /** The newest frame and when it was taken; null while there is none yet. */
  next: () => { jpg: Buffer | null; at: number } | Promise<{ jpg: Buffer | null; at: number }>;
  /** The highest rate to send at. */
  fps: number;
  /** Called on every tick, so the source knows someone is still watching. */
  onTick?: () => void;
}

export function mjpegResponse(req: Request, src: FrameSource): Response {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastAt = -1;
  const stopAll = () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };
  req.signal.addEventListener("abort", stopAll);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const tick = async () => {
        if (closed) return;
        try {
          src.onTick?.();
          const f = await src.next();
          if (f.jpg && f.at !== lastAt) {
            lastAt = f.at;
            const head = "--" + BOUNDARY + "\r\nContent-Type: image/jpeg\r\nContent-Length: " + f.jpg.length + "\r\n\r\n";
            controller.enqueue(enc.encode(head));
            controller.enqueue(new Uint8Array(f.jpg));
            controller.enqueue(enc.encode("\r\n"));
          }
        } catch {
          stopAll();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        timer = setTimeout(() => void tick(), Math.max(15, Math.round(1000 / src.fps)));
      };
      void tick();
    },
    cancel: stopAll,
  });

  return new Response(stream, {
    headers: {
      "content-type": "multipart/x-mixed-replace; boundary=" + BOUNDARY,
      "cache-control": "no-store, no-cache, must-revalidate",
      pragma: "no-cache",
    },
  });
}
