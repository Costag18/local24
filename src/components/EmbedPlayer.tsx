"use client";

import { useEffect, useRef } from "react";
import {
  applyPlayerState, isUnplayable, parsePlayerEvent, postPlayerCommand, randomIndex,
  randomStartSeconds, startListening, toggleMuted, usePlayer,
} from "@/lib/player";

interface Props {
  /** Changing this resets the randomiser — a new source gets a new roll. */
  sourceKey: string;
  src: string;
  title: string;
  /** A second pane stays silent; audio belongs to the main channel. */
  silent?: boolean;
  /**
   * A live broadcast: play from the live edge, never a random point. A live
   * stream reports its rewind buffer as its duration, so the random start
   * would otherwise drop it hours into the past.
   */
  live?: boolean;
  onLoaded?: () => void;
}

/**
 * How long a source stays eligible for its random start.
 *
 * The player answers the handshake whenever it finishes booting, which on a
 * cold start can be many seconds. Seeking on a late answer yanks a video the
 * user is already watching, so past this point the roll is simply skipped.
 */
const ROLL_WINDOW_MS = 12_000;

/** Give up handshaking after this; the player is clearly not going to answer. */
const HANDSHAKE_MS = 45_000;

/** A playlist can hold a run of dead videos, but not an endless one. */
const MAX_SKIPS = 8;

/**
 * An embedded player with its own lid.
 *
 * Nothing may hover the iframe, so YouTube's chrome never appears — which also
 * puts its controls out of reach, hence the volume living in lib/player. Both
 * the main channel and any other pane use this, so they behave identically.
 */
export function EmbedPlayer({ sourceKey, src, title, silent = false, live = false, onLoaded }: Props) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const player = usePlayer();
  const volume = silent ? 0 : player.volume;
  const muted = silent || player.muted;

  // The player ignores commands until it has booted, and `load` fires well
  // before that, so the volume is pushed again on a short cascade.
  useEffect(() => {
    const at = [0, 400, 1200, 3000].map((d) =>
      setTimeout(() => applyPlayerState(frame.current, { volume, muted }), d),
    );
    return () => at.forEach(clearTimeout);
  }, [volume, muted, sourceKey]);

  /**
   * Start somewhere new every time, and step over what will not play.
   *
   * A pane that always opens on the same video at 0:00 stops feeling like a
   * channel, so each source jumps to a random item and a random point inside
   * it. Videos that have been removed, made private or blocked from embedding
   * report an error instead of playing — those are skipped.
   */
  useEffect(() => {
    if (!src) return;
    const frameEl = frame.current;
    const startedAt = Date.now();
    let rolledItem = false;
    let rolledTime = false;
    let answered = false;
    let skips = 0;

    // Keep asking until it answers: a single burst of handshakes at mount can
    // land entirely before the player exists, and then nothing ever replies.
    const handshake = setInterval(() => {
      if (answered || Date.now() - startedAt > HANDSHAKE_MS) {
        clearInterval(handshake);
        return;
      }
      startListening(frame.current);
    }, 1000);
    startListening(frameEl);

    const onMessage = (e: MessageEvent) => {
      if (!e.origin.endsWith("youtube.com")) return;
      const msg = parsePlayerEvent(e.data);
      if (!msg) return;
      answered = true;

      if (isUnplayable(msg.errorCode)) {
        if (skips < MAX_SKIPS) {
          skips += 1;
          // A dead entry also means the roll never happened here; let the next
          // video have it.
          rolledTime = false;
          postPlayerCommand(frame.current, "nextVideo");
        }
        return;
      }

      const info = msg.event === "infoDelivery" ? msg.info : undefined;
      if (!info) return;

      // Live plays where it is; too late to move the picture without it
      // reading as a glitch.
      if (live || Date.now() - startedAt > ROLL_WINDOW_MS) return;

      // Pick the video first; the jump reports a fresh duration to seek in.
      if (!rolledItem && Array.isArray(info.playlist) && info.playlist.length > 1) {
        rolledItem = true;
        const i = randomIndex(info.playlist.length);
        if (i !== info.playlistIndex) {
          postPlayerCommand(frame.current, "playVideoAt", [i]);
          return;
        }
      }

      if (!rolledTime && typeof info.duration === "number" && info.duration >= 60) {
        rolledTime = true;
        const at = randomStartSeconds(info.duration);
        if (at > 0) postPlayerCommand(frame.current, "seekTo", [at, true]);
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      clearInterval(handshake);
      window.removeEventListener("message", onMessage);
    };
  }, [src, sourceKey, live]);

  return (
    <>
      <iframe
        key={sourceKey}
        ref={frame}
        src={src}
        title={title}
        onLoad={onLoaded}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
      />
      {/*
        A transparent lid. The pointer never reaches the iframe, so YouTube's
        hover chrome — title bar, scrubber, watch-later, the share overlay —
        never appears. Double-clicking mutes the dashboard.
      */}
      <div
        className="absolute inset-0"
        // The lid also hides YouTube's play button, so a click has to be able
        // to restart a player that stalled or was refused autoplay.
        onClick={() => postPlayerCommand(frame.current, "playVideo")}
        onDoubleClick={silent ? undefined : toggleMuted}
        title={silent ? title : "Click to resume · Ctrl+K for volume · ↑ ↓ volume · M mute"}
        style={{ cursor: "default" }}
      />
    </>
  );
}
