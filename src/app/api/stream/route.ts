import { startPoller } from "@/lib/poller";
import { noteAudience, onChanged } from "@/lib/live";
import { snapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/**
 * Server-sent events rather than polling, so a change reaches the screen when
 * it happens: the poller announces each finished refresh (see lib/live), and
 * this sends the shared snapshot at once. A slow timer still runs underneath,
 * both as a keep-alive and for the parts of the state that move with the clock
 * rather than with a fetch — fight cards ending, events passing.
 */
export async function GET(req: Request) {
  startPoller();
  noteAudience();

  const encoder = new TextEncoder();
  let timer: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  const stream = new ReadableStream({
    start(controller) {
      let lastSent = "";

      /**
       * Only sends when something actually changed. Re-sending an identical
       * payload replaced the client's whole state object and re-rendered every
       * window for nothing; a comment frame keeps the connection warm instead.
       */
      const send = (force = false) => {
        try {
          noteAudience();
          const snap = snapshot();
          if (!force && snap.fingerprint === lastSent) {
            controller.enqueue(encoder.encode(": idle\n\n"));
            return;
          }
          lastSent = snap.fingerprint;
          controller.enqueue(encoder.encode(`event: state\ndata: ${snap.json}\n\n`));
        } catch (err) {
          // Enqueueing on a stream the client already closed throws; stop.
          if (String(err).includes("Invalid state")) stop();
          else console.error("[stream] send failed:", err);
        }
      };

      send(true);
      unsubscribe = onChanged(() => send());
      timer = setInterval(() => send(), 15_000);

      // The client aborting (tab closed, navigation) must tear everything
      // down, or a long-running kiosk accumulates orphaned listeners.
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
