"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ago, shortCamLabel } from "@/lib/format";
import { embedUrl, watchUrl } from "@/lib/channels";
import { useRotation } from "./hooks";
import { useCamFrame } from "./useCamFrame";
import type { Camera, VideoCam } from "@/lib/types";
import type { CamStatus } from "@/lib/sources/livecams";

interface Props {
  cams: Camera[];
  videoCams: VideoCam[];
  camStatus: CamStatus[];
  dwellMs: number;
  videoDwellMs: number;
  refreshMs: number;
  /** Held on the current camera by the window's lock. */
  locked?: boolean;
  now: number;
  suspendVideo: boolean;
  onExpand: () => void;
  pinned: string | null;
  onPin: (id: string | null) => void;
}

/** Direct source URL, cache-busted. Thumbnails cost the server nothing. */
function directSrc(cam: Camera, tick: number): string {
  const sep = cam.imageUrl.includes("?") ? "&" : "?";
  return `${cam.imageUrl}${sep}t=${tick}`;
}

/**
 * Live video on top, snapshots cycling in a strip below.
 *
 * Neither camera network publishes video — both are JPEG snapshots that change
 * roughly once a minute (Toronto) or every twenty seconds (511) — so the large
 * area is given to a real live stream and the snapshots are demoted to a small
 * rotating strip, where a slow refresh reads as intended rather than broken.
 */
export function CameraBand({
  cams, videoCams, camStatus, dwellMs, videoDwellMs, refreshMs, locked = false, now, suspendVideo, onExpand, pinned, onPin,
}: Props) {
  const live = useMemo(() => cams.filter((c) => !c.dead), [cams]);

  // A stream that has ended renders as a dead player, so cycle past it. If the
  // check has not run yet, or every cam reads dead, show them anyway rather
  // than an empty panel.
  const usableVideo = useMemo(() => {
    if (!camStatus.length) return videoCams;
    const ok = videoCams.filter((v) => camStatus.find((s) => s.id === v.id)?.live !== false);
    return ok.length ? ok : videoCams;
  }, [videoCams, camStatus]);

  const hasVideo = usableVideo.length > 0;

  const [videoIndex, setVideoIndex] = useRotation(
    usableVideo.length,
    videoDwellMs,
    locked || suspendVideo,
  );
  const video = usableVideo[Math.min(videoIndex, Math.max(0, usableVideo.length - 1))] ?? null;
  const videoSrc = video ? embedUrl({ id: video.id, label: video.label, type: "youtube", ref: video.ref }) : null;

  // With video present the strip carries several snapshots; without it, one
  // snapshot is promoted to fill the space instead.
  const stripCount = hasVideo ? 10 : 8;
  const [rotIndex, setRotIndex] = useRotation(live.length, dwellMs, locked || Boolean(pinned));
  const [tick, setTick] = useState(() => Date.now());
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [stripHover, setStripHover] = useState(false);

  /**
   * Thumbnails refresh far less often than the hero.
   *
   * They are small, the sources publish about once a minute, and every tick
   * re-downloaded all ten straight from the City's servers — a steady 60 KB/s
   * for pictures that had not changed. Swapping images mid-crawl also cost a
   * decode on every one of them.
   */
  const thumbMs = refreshMs > 0 ? Math.max(30_000, refreshMs * 6) : 0;
  useEffect(() => {
    if (thumbMs <= 0) return;
    const t = setInterval(() => setTick(Date.now()), thumbMs);
    return () => clearInterval(t);
  }, [thumbMs]);

  const heroIndex = useMemo(() => {
    if (!pinned) return rotIndex;
    const i = live.findIndex((c) => c.id === pinned);
    return i >= 0 ? i : rotIndex;
  }, [pinned, live, rotIndex]);

  const hero = live[heroIndex] ?? null;

  // The strip shows a moving window of the playlist so it visibly cycles.
  const strip = useMemo(() => {
    if (!live.length) return [];
    const out: Camera[] = [];
    for (let i = 0; i < Math.min(stripCount, live.length); i++) {
      out.push(live[(heroIndex + i) % live.length]);
    }
    return out;
  }, [live, heroIndex, stripCount]);

  // One lap is the width of a single copy of the strip; ~14px/s is slow enough
  // to take each camera in as it passes.
  const stripDuration = Math.max(20, (strip.length * 109) / 14);

  // Only the promoted snapshot is proxied (for frame age and rewind).
  // A hidden tab already arrives as refreshMs 0, so nothing else pauses stills.
  const heroFrame = useCamFrame(hasVideo ? null : (hero?.id ?? null), refreshMs, false);

  // The P key: pin whatever is showing, or let rotation resume.
  useEffect(() => {
    const toggle = () => onPin(pinned ? null : (hero?.id ?? null));
    window.addEventListener("local24:pin-toggle", toggle);
    return () => window.removeEventListener("local24:pin-toggle", toggle);
  }, [onPin, pinned, hero]);

  const promote = useCallback(
    (cam: Camera) => setRotIndex(live.findIndex((c) => c.id === cam.id)),
    [live, setRotIndex],
  );

  return (
    // `cb` makes the panel a size container: the stylesheet moves the strip
    // beside the picture in a wide window and below it, as a grid, in a tall one.
    <section className="panel cb flex flex-col" style={{ minHeight: 0 }}>
      <div className="slab">
        <span className="label label-accent slab-name">Cameras</span>
        {hasVideo ? (
          <>
            <span className="live-dot" />
            <span className="label wrap2 flex-1" style={{ minWidth: 0 }}>{video?.label ?? ""}</span>
            {usableVideo.length > 1 && (
              <div className="flex gap-1 shrink-0 cb-dots">
                {usableVideo.map((v, i) => (
                  <button
                    key={v.id}
                    onClick={() => setVideoIndex(i)}
                    title={v.label}
                    style={{
                      width: 10, height: 3,
                      background: i === videoIndex ? "var(--accent)" : "var(--line)",
                    }}
                  />
                ))}
              </div>
            )}
            <span className="label num shrink-0" style={{ color: "var(--ink-faint)" }}>
              {videoIndex + 1}/{usableVideo.length}
            </span>
            {video && (
              <a href={watchUrl({ id: video.id, label: video.label, type: "youtube", ref: video.ref })}
                 target="_blank" rel="noreferrer" className="label shrink-0">↗</a>
            )}
          </>
        ) : (
          <>
            <span className="label wrap2 flex-1" style={{ minWidth: 0 }}>{hero?.label ?? ""}</span>
            <span className="label num" style={{ color: "var(--ink-faint)" }}>
              {heroIndex + 1}/{live.length}
            </span>
            <button
              onClick={() => onPin(pinned ? null : (hero?.id ?? null))}
              className="label px-1"
              style={{ color: pinned ? "var(--accent)" : "var(--ink-dim)" }}
              title={pinned ? "Unpin (resume rotation)" : "Pin this camera"}
            >
              {pinned ? "PINNED" : "PIN"}
            </button>
          </>
        )}
        <button onClick={onExpand} className="label px-1" title="Expand cameras to full screen" style={{ fontSize: "1.1em" }}>
          ⛶
        </button>
      </div>

      <div className="cb-body" style={{ background: "var(--line)" }}>
        {/* Main area: live video when configured, otherwise a promoted snapshot. */}
        <div className="cb-hero relative" style={{ background: "#000" }}>
          {hasVideo ? (
            suspendVideo ? (
              <div className="absolute inset-0 grid place-items-center label">Video paused</div>
            ) : videoSrc ? (
              <>
                <iframe
                  key={video?.id}
                  src={videoSrc}
                  title={video?.label ?? "Live camera"}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                />
                {/* A transparent shield over the player. This panel is ambient,
                    so hovering it should not raise YouTube's own title bar and
                    controls — and it cannot steal keyboard focus either. Use
                    the ↗ link in the header to open the stream properly. */}
                <div
                  aria-hidden
                  style={{ position: "absolute", inset: 0, background: "transparent", cursor: "default" }}
                />
              </>
            ) : (
              <div className="absolute inset-0 grid place-items-center label px-4 text-center">
                That live cam URL can’t be embedded — set another in Settings
              </div>
            )
          ) : heroFrame.src && !heroFrame.failed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroFrame.src}
              alt={hero?.label ?? ""}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center label" style={{ color: "var(--dead)" }}>
              {heroFrame.failed ? "Signal lost" : "Loading…"}
            </div>
          )}

          {!hasVideo && (
            <div
              className="absolute left-0 bottom-0 right-0 flex items-center gap-2 px-3 py-1"
              style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.82))" }}
            >
              <span className="live-dot" style={{ opacity: heroFrame.justChanged ? 1 : 0.45 }} />
              <span className="label" style={{ color: "#fff" }}>{hero?.roadway || "LIVE"}</span>
              <span className="flex-1" />
              {/* Snapshot age, so a quiet street does not read as a dead feed. */}
              <span className="label" style={{ color: heroFrame.justChanged ? "var(--ok)" : "rgba(255,255,255,0.5)" }}>
                {heroFrame.justChanged ? "NEW FRAME" : heroFrame.frameAt ? ago(heroFrame.frameAt, now) : "…"}
              </span>
            </div>
          )}
        </div>

        {/* Snapshot strip — a slow horizontal carousel. These are stills that
            change once a minute, so scrolling them is what makes the row read
            as alive; the track holds two copies so the loop has no seam. */}
        {strip.length > 0 && (
          <div
            className={`hcrawl cb-strip ${stripHover ? "hcrawl-paused" : ""}`}
            style={{ "--strip": hasVideo ? "30%" : "34%" } as React.CSSProperties}
            onPointerEnter={() => setStripHover(true)}
            onPointerLeave={() => setStripHover(false)}
          >
            <div className="hcrawl-track" style={{ animationDuration: `${stripDuration}s` }}>
              {[0, 1].map((copy) => (
                <div key={copy} className="cb-copy" aria-hidden={copy === 1}>
                  {strip.map((cam) => (
                    <button
                      key={`${copy}-${cam.id}`}
                      onClick={() => promote(cam)}
                      className="cb-thumb relative shrink-0"
                      style={{ background: "#000" }}
                      title={cam.label}
                    >
                      {!failed[cam.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={directSrc(cam, tick)}
                          alt={cam.label}
                          onError={() => setFailed((f) => ({ ...f, [cam.id]: true }))}
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <span className="absolute inset-0 grid place-items-center label" style={{ color: "var(--dead)" }}>
                          ✕
                        </span>
                      )}
                      <span
                        className="absolute left-0 right-0 bottom-0 px-1 py-0.5 text-left cam-caption"
                        style={{
                          background: "rgba(0,0,0,0.72)",
                          color: "#fff",
                          // Intersection names are long, so this drops below the
                          // shared label size and loses the wide tracking.
                          fontSize: "8px",
                          letterSpacing: "0.01em",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          lineHeight: 1.25,
                        }}
                      >
                        {shortCamLabel(cam.label)}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
