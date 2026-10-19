/**
 * A camera as a continuous stream (MJPEG): one long response that keeps
 * sending the next JPEG as soon as there is one. Browsers play it in a plain
 * <img>, with no polling, which is the difference between one frame a second
 * and fifteen or twenty.
 *
 * A viewer slower than the camera — a PS3 on Wi-Fi — must not make the server
 * pile frames up in memory. The stream holds at most about one frame in its
 * queue; while that has not drained, new frames are skipped rather than
 * queued, so a slow screen simply sees fewer of them. The number of streams
 * open at once is capped too.
 */

const BOUNDARY = "local24frame";
/** Roughly one big frame: beyond this the viewer is behind, so frames are dropped. */
const QUEUE_BYTES = 256 * 1024;
/** Every screen in the house, with room to spare; beyond this a stream is refused. */
const MAX_STREAMS = 12;

const g = globalThis as unknown as { __local24Streams?: { open: number } };
const streams = (g.__local24Streams ??= { open: 0 });

export interface FrameSource {
  /** The newest frame and when it was taken; null while there is none yet. */
  next: () => { jpg: Buffer | null; at: number } | Promise<{ jpg: Buffer | null; at: number }>;
  /** The highest rate to send at. */
  fps: number;
  /** Called on every tick, so the source knows someone is still watching. */
  onTick?: () => void;
}

export function mjpegResponse(req: Request, src: FrameSource): Response {
  if (streams.open >= MAX_STREAMS) {
    return new Response("too many streams open", { status: 503, headers: { "retry-after": "5" } });
  }
  streams.open++;

  const enc = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastAt = -1;
  const stopAll = () => {
    if (closed) return;
    closed = true;
    streams.open = Math.max(0, streams.open - 1);
    if (timer) clearTimeout(timer);
  };
  req.signal.addEventListener("abort", stopAll);

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const tick = async () => {
          if (closed) return;
          try {
            src.onTick?.();
            // Only fetch and send a frame if the last one has gone out.
            if ((controller.desiredSize ?? 0) > 0) {
              const f = await src.next();
              if (f.jpg && f.at !== lastAt && !closed) {
                lastAt = f.at;
                const head = "--" + BOUNDARY + "\r\nContent-Type: image/jpeg\r\nContent-Length: " + f.jpg.length + "\r\n\r\n";
                controller.enqueue(enc.encode(head));
                controller.enqueue(new Uint8Array(f.jpg));
                controller.enqueue(enc.encode("\r\n"));
              }
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
    },
    new ByteLengthQueuingStrategy({ highWaterMark: QUEUE_BYTES }),
  );

  return new Response(stream, {
    headers: {
      "content-type": "multipart/x-mixed-replace; boundary=" + BOUNDARY,
      "cache-control": "no-store, no-cache, must-revalidate",
      pragma: "no-cache",
    },
  });
}
