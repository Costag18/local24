"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "@/lib/state";

interface Result {
  state: AppState | null;
  connected: boolean;
  error: string | null;
  refresh: (job?: string) => Promise<void>;
  /** Re-reads the state without asking the poller to fetch anything. */
  reload: () => Promise<void>;
}

/**
 * Subscribes to the SSE stream. If EventSource fails (or the stream drops),
 * falls back to interval polling so the screen keeps updating rather than
 * freezing on the last payload.
 */
export function useAppState(): Result {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const buildRef = useRef<string | null>(null);

  /**
   * Takes a fresh payload, and reloads the page if the server is now running
   * a newer build. A kiosk left open for days would otherwise keep running
   * the old interface after every update until someone pressed F5.
   */
  const accept = useCallback((next: AppState) => {
    if (next.build && buildRef.current && next.build !== buildRef.current && next.build !== "dev") {
      window.location.reload();
      return;
    }
    buildRef.current = next.build ?? buildRef.current;
    setState(next);
  }, []);

  const pollOnce = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      accept((await res.json()) as AppState);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "offline");
    }
  }, [accept]);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    const startPolling = () => {
      if (pollRef.current) return;
      void pollOnce();
      pollRef.current = setInterval(() => void pollOnce(), 15_000);
    };

    const stopPolling = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };

    try {
      es = new EventSource("/api/stream");
      es.addEventListener("state", (ev) => {
        if (closed) return;
        try {
          accept(JSON.parse((ev as MessageEvent).data) as AppState);
          setConnected(true);
          setError(null);
          stopPolling();
        } catch {
          /* a malformed frame is not worth tearing the stream down for */
        }
      });
      es.onerror = () => {
        setConnected(false);
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      closed = true;
      es?.close();
      stopPolling();
    };
  }, [pollOnce, accept]);

  const refresh = useCallback(
    async (job?: string) => {
      try {
        await fetch("/api/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ job: job ?? "all" }),
        });
      } catch {
        /* health page will show what failed */
      }
      await pollOnce();
    },
    [pollOnce],
  );

  return { state, connected, error, refresh, reload: pollOnce };
}
