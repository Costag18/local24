"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { embedUrl, mixEmbedUrl, mixSources, parseChannelRef, watchUrl } from "@/lib/channels";
import { toggleMuted, usePlayer } from "@/lib/player";
import { EmbedPlayer } from "./EmbedPlayer";
import type { Channel } from "@/lib/types";

interface Props {
  channels: Channel[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Video is suspended while the tab is hidden or data-saver is on. */
  suspend: boolean;
  onSetRef: (channelId: string, ref: string) => void;
}

export function MainPane({ channels, activeId, onSelect, suspend, onSetRef }: Props) {
  const active = useMemo(
    () => channels.find((c) => c.id === activeId) ?? channels[0] ?? null,
    [channels, activeId],
  );
  const [loaded, setLoaded] = useState(false);
  // Bumped on every selection so the caption replays even when the channel
  // picked is the one already playing.
  const [nudge, setNudge] = useState(0);
  useEffect(() => setNudge((n) => n + 1), [activeId]);
  const [slow, setSlow] = useState(false);
  const [draft, setDraft] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = usePlayer();

  const parsed = active ? parseChannelRef(active.ref) : null;

  /**
   * A channel plays whatever it is streaming right now, which means finding
   * out what that is. YouTube's own `live_stream?channel=` embed answers "This
   * video is unavailable" these days, so the server resolves the live video id
   * and the pane embeds that like any other video.
   */
  const [liveId, setLiveId] = useState<string | null>(null);
  const channelId = parsed?.type === "youtube-live" ? parsed.ref : null;

  useEffect(() => {
    setLiveId(null);
    if (!channelId) return;
    let cancelled = false;
    const resolve = () =>
      void fetch(`/api/live?channel=${encodeURIComponent(channelId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { videoId?: string | null }) => {
          if (!cancelled) setLiveId(d.videoId ?? null);
        })
        .catch(() => undefined);
    resolve();
    // A stream that ends is replaced by a new id; re-check while it is open.
    const t = setInterval(resolve, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [channelId]);

  /**
   * A mixed channel ("UC…, PL…") plays several sources as one list. An embed
   * takes one list only, so the server merges them into video ids.
   */
  const mix = active ? mixSources(active.ref) : null;
  const mixKey = mix ? mix.join(",") : null;
  const [mixIds, setMixIds] = useState<string[] | null>(null);

  useEffect(() => {
    setMixIds(null);
    if (!mixKey) return;
    let cancelled = false;
    void fetch(`/api/mix?sources=${encodeURIComponent(mixKey)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ids?: string[] }) => {
        if (!cancelled) setMixIds(d.ids ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mixKey]);

  const src = active
    ? channelId
      ? liveId
        ? embedUrl({ ...active, type: "youtube", ref: liveId })
        : null
      : mixKey
        ? mixIds
          ? mixEmbedUrl(mixIds)
          : null
        : embedUrl(active)
    : null;

  // An iframe cannot reliably report a refused embed, so "never signalled load"
  // is treated as the failure case and the watch link is offered instead of a
  // permanent black rectangle.
  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    setDraft("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSlow(true), 8000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active?.id, active?.ref, suspend]);

  const commit = () => {
    if (active && draft.trim()) onSetRef(active.id, draft.trim());
  };

  return (
    <section className="panel flex flex-col" style={{ minHeight: 0, flex: 1 }}>
      <div className="slab slab-quiet">
        <span className="label label-accent slab-name">Channel</span>
        <div className="flex items-center gap-1 flex-1" style={{ minWidth: 0 }}>
          {channels.map((c, i) => {
            const on = c.id === active?.id;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className="label px-2 py-1 border transition-colors truncate"
                style={{
                  borderColor: on ? "transparent" : "var(--line)",
                  background: on ? (c.accent ?? "var(--accent)") : "transparent",
                  color: on ? "#fff" : c.ref ? "var(--ink-dim)" : "var(--ink-faint)",
                  minWidth: 0,
                  flex: "0 1 auto",
                }}
                title={`${c.label} — press ${i + 1}${c.ref ? "" : " (not set up)"}`}
              >
                <span style={{ opacity: 0.65 }}>{i + 1}</span> {c.label}
                {!c.ref && <span style={{ opacity: 0.6 }}> ·</span>}
              </button>
            );
          })}
        </div>
        <button
          onClick={toggleMuted}
          className="label shrink-0 px-1"
          title="Mute / unmute (M) — volume in Ctrl+K"
          style={{ color: player.muted ? "var(--ink-faint)" : "var(--ink-dim)" }}
        >
          {player.muted ? "🔇" : "🔊"} {player.muted ? "MUTE" : `${player.volume}`}
        </button>
        {active && active.ref && (
          <a href={watchUrl(active)} target="_blank" rel="noreferrer" className="label shrink-0">
            OPEN ↗
          </a>
        )}
      </div>

      <div data-video className="relative flex-1" style={{ background: "#000", minHeight: 0 }}>
        {/*
          The name of what is playing, shown for a moment after a change and
          then gone. A permanent channel bar is a row of buttons you look at
          far more often than you press; the arrow keys do the switching.
        */}
        {active && (
          <div key={`${active.id}:${nudge}`} className="channel-flash">
            <span className="tag" style={{ background: active.accent ?? "var(--accent)", color: "#fff" }}>
              {channels.findIndex((c) => c.id === active.id) + 1}
            </span>
            <span className="label" style={{ color: "#fff" }}>{active.label}</span>
            {player.muted && <span className="label" style={{ color: "var(--ink-faint)" }}>MUTED</span>}
          </div>
        )}
        {!active ? (
          <div className="absolute inset-0 grid place-items-center label">No channels configured</div>
        ) : !active.ref ? (
          <SetupCard
            label={active.label}
            draft={draft}
            setDraft={setDraft}
            onCommit={commit}
          />
        ) : suspend ? (
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="label">Video paused</div>
              <div className="text-sm mt-1" style={{ color: "var(--ink-dim)" }}>
                Tab hidden or data-saver on
              </div>
            </div>
          </div>
        ) : (channelId && !liveId) || (mixKey && !mixIds) ? (
          // Resolving which video the channel is streaming. A second, usually.
          <div className="absolute inset-0 grid place-items-center label" style={{ color: "var(--ink-faint)" }}>
            Tuning in…
          </div>
        ) : !src ? (
          <Fallback
            label={active.label}
            href={watchUrl(active)}
            reason={
              parsed && !parsed.embeddable
                ? "A YouTube @handle can't be embedded — paste the channel's /live or a video URL instead."
                : "This source can't be embedded."
            }
          />
        ) : (
          <>
            <EmbedPlayer
              sourceKey={`${active.id}:${liveId ?? active.ref}`}
              src={src}
              live={Boolean(channelId)}
              title={active.label}
              onLoaded={() => setLoaded(true)}
            />
            {!loaded && slow && (
              <Fallback
                label={active.label}
                href={watchUrl(active)}
                reason="This channel may not allow embedding."
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Fallback({ label, href, reason }: { label: string; href: string; reason: string }) {
  return (
    <div
      className="absolute inset-0 grid place-items-center text-center px-6"
      style={{ background: "rgba(5,7,13,0.94)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="label label-accent">{label}</div>
        <div className="text-sm" style={{ color: "var(--ink-dim)", maxWidth: "42ch" }}>
          {reason}
        </div>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="label px-3 py-2"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          Open on youtube.com ↗
        </a>
      </div>
    </div>
  );
}

/** First-run affordance: set a channel's source without leaving the dashboard. */
function SetupCard({
  label, draft, setDraft, onCommit,
}: {
  label: string;
  draft: string;
  setDraft: (v: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center px-6">
      <div className="flex flex-col items-center gap-3 w-full" style={{ maxWidth: 520 }}>
        <div className="label label-accent">Set up “{label}”</div>
        <div className="text-sm text-center" style={{ color: "var(--ink-dim)" }}>
          Paste a YouTube URL — a video, a playlist, or a channel’s <code>/live</code> page.
          A direct <code>.m3u8</code> stream works too.
        </div>
        <div className="flex w-full gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit();
            }}
            placeholder="https://www.youtube.com/watch?v=…"
            className="flex-1 px-3 py-2 text-sm outline-none"
            style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)" }}
          />
          <button
            onClick={onCommit}
            className="label px-4"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            Save
          </button>
        </div>
        <div className="label" style={{ color: "var(--ink-faint)" }}>
          Change it any time in Settings
        </div>
      </div>
    </div>
  );
}
