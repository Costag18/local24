"use client";

import { useEffect, useRef, useState } from "react";

export interface CamFrame {
  /** Object URL for the current frame, or null before the first load. */
  src: string | null;
  /** When the source last produced a genuinely new frame (epoch ms). */
  frameAt: number | null;
  /** True briefly after a frame that differs from the previous one. */
  justChanged: boolean;
  failed: boolean;
}

/**
 * Fetches the hero camera through the proxy so response headers can be read.
 *
 * These are snapshot cameras, not video — Toronto publishes roughly once a
 * minute, Ontario 511 about every twenty seconds — so an unchanged picture is
 * normal, not a fault. Reading the frame's real timestamp lets the UI say how
 * old the picture is and flash when a new one actually lands, which is the
 * difference between "live but quiet" and "looks broken".
 */
export function useCamFrame(camId: string | null, intervalMs: number, paused: boolean): CamFrame {
  const [state, setState] = useState<CamFrame>({
    src: null, frameAt: null, justChanged: false, failed: false,
  });
  const urlRef = useRef<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!camId || intervalMs <= 0) return;
    let cancelled = false;

    const revoke = () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };

    const load = async () => {
      try {
        const res = await fetch(`/api/cam/${encodeURIComponent(camId)}?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setState((s) => ({ ...s, failed: true }));
          return;
        }
        const changed = res.headers.get("x-local24-changed") === "1";
        const at = Number(res.headers.get("x-local24-frame-at"));
        const blob = await res.blob();
        if (cancelled) return;

        const next = URL.createObjectURL(blob);
        const prev = urlRef.current;
        urlRef.current = next;
        if (prev) URL.revokeObjectURL(prev);

        setState({
          src: next,
          frameAt: Number.isFinite(at) && at > 0 ? at : null,
          justChanged: changed,
          failed: false,
        });

        if (changed) {
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(
            () => !cancelled && setState((s) => ({ ...s, justChanged: false })),
            1400,
          );
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, failed: true }));
      }
    };

    void load();
    const t = paused ? null : setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      revoke();
    };
  }, [camId, intervalMs, paused]);

  return state;
}
