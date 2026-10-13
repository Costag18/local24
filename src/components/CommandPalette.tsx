"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nudgeVolume, setVolume, toggleMuted, usePlayer } from "@/lib/player";
import type { Camera, Channel, Item } from "@/lib/types";

export interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  cams: Camera[];
  extra: Command[];
  onChannel: (id: string) => void;
  onCam: (id: string) => void;
}

/** Subsequence match, so "dvp e" finds "DVP Eastbound". */
export function fuzzyMatch(needle: string, hay: string): boolean {
  const n = needle.toLowerCase().replace(/\s+/g, "");
  if (!n) return true;
  const h = hay.toLowerCase();
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

export function CommandPalette({ open, onClose, channels, cams, extra, onChannel, onCam }: Props) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [results, setResults] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Full-text search over everything ingested, debounced.
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d: { results?: Item[] }) => setResults((d.results ?? []).slice(0, 8)))
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const commands = useMemo<Command[]>(() => {
    const chans = channels.map((c) => ({
      id: `ch:${c.id}`,
      group: "Channel",
      label: c.label,
      run: () => onChannel(c.id),
    }));
    const camCmds = cams.slice(0, 400).map((c) => ({
      id: `cam:${c.id}`,
      group: "Camera",
      label: c.label,
      hint: c.roadway,
      run: () => onCam(c.id),
    }));
    return [...extra, ...chans, ...camCmds];
  }, [channels, cams, extra, onChannel, onCam]);

  const filtered = useMemo(
    () => commands.filter((c) => fuzzyMatch(q, `${c.group} ${c.label} ${c.hint ?? ""}`)).slice(0, 40),
    [commands, q],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const hit = filtered[sel];
        if (hit) {
          hit.run();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, sel, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      style={{ background: "rgba(2,4,9,0.82)" }}
      onClick={onClose}
    >
      <div
        className="panel w-full"
        style={{ maxWidth: 680, maxHeight: "70vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="slab">
          <span className="label label-accent">Go to</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            placeholder="Channel, camera, or search all headlines…"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "var(--ink)" }}
          />
          <span className="label" style={{ color: "var(--ink-faint)" }}>ESC</span>
        </div>

        <VolumeBar />

        <div className="scroll-y" style={{ minHeight: 0 }}>
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                c.run();
                onClose();
              }}
              className="flex items-center gap-3 w-full px-3 py-2 text-left border-b"
              style={{
                borderColor: "var(--line)",
                background: i === sel ? "var(--panel-2)" : "transparent",
              }}
            >
              <span className="label" style={{ width: "7ch", color: "var(--accent)" }}>{c.group}</span>
              <span className="text-sm truncate flex-1">{c.label}</span>
              {c.hint && <span className="label truncate" style={{ maxWidth: "16ch" }}>{c.hint}</span>}
            </button>
          ))}

          {results.length > 0 && (
            <>
              <div className="label px-3 py-2" style={{ background: "var(--panel-2)" }}>
                Archive
              </div>
              {results.map((r) => (
                <a
                  key={r.id}
                  href={r.link || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col gap-0.5 px-3 py-2 border-b"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="text-sm truncate">{r.title}</span>
                  <span className="label">{String(r.meta?.source ?? r.sourceId)}</span>
                </a>
              ))}
            </>
          )}

          {!filtered.length && !results.length && (
            <div className="label px-3 py-6 text-center">No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The video pane is shielded from the pointer so YouTube's own controls never
 * surface, which leaves this as the volume. Buttons for the coarse moves, a
 * slider for the fine ones.
 */
const PRESETS = [0, 25, 50, 75, 100];

function VolumeBar() {
  const player = usePlayer();
  const shown = player.muted ? 0 : player.volume;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b"
      style={{ borderColor: "var(--line)", background: "var(--panel-2)" }}
    >
      <button
        onClick={toggleMuted}
        className="label"
        style={{ width: "7ch", color: "var(--accent)", textAlign: "left" }}
        title="Mute / unmute"
      >
        {player.muted ? "🔇 MUTE" : "🔊 VOL"}
      </button>

      <button className="label px-1" onClick={() => nudgeVolume(-10)} title="Quieter">
        −
      </button>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        onChange={(e) => setVolume(Number(e.target.value))}
        // Otherwise the palette's own arrow-key handler moves the selection
        // while the slider is being nudged.
        onKeyDown={(e) => e.stopPropagation()}
        className="flex-1"
        style={{ accentColor: "var(--accent)", minWidth: 0 }}
        aria-label="Volume"
      />

      <button className="label px-1" onClick={() => nudgeVolume(10)} title="Louder">
        +
      </button>

      <span className="label" style={{ width: "4ch", textAlign: "right" }}>
        {shown}
      </span>

      <span className="flex items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setVolume(p)}
            className="label px-1"
            style={{ color: shown === p ? "var(--accent)" : "var(--ink-faint)" }}
            title={`Set volume to ${p}`}
          >
            {p}
          </button>
        ))}
      </span>
    </div>
  );
}
