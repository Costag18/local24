"use client";

import { useEffect, useRef, useState } from "react";
import { binsReminder, clockTime, daysUntil, duration, longDate, shortTime, temp } from "@/lib/format";
import { useNow } from "./hooks";
import type { Pickup, Weather } from "@/lib/types";
import type { PrinterView } from "@/lib/printer";
import { LayoutMenu } from "./LayoutMenu";

interface Props {
  weather: Weather | null;
  connected: boolean;
  offline: boolean;
  onBattery: boolean;
  kiosk: boolean;
  night: boolean;
  dataSaver: boolean;
  /** A printer is set up, so its progress can show here while it prints. */
  printer: boolean;
  /** The next garbage collection; a reminder shows the evening before. */
  pickup: Pickup | null;
  /** The next Ontario holiday; mentioned from two days out. */
  holiday: { date: string; name: string } | null;
  /** A running kitchen timer, as its end time. */
  timer: { endsAt: number; label: string } | null;
  onTimerClear: () => void;
  layout: React.ComponentProps<typeof LayoutMenu>;
  onOpenPalette: () => void;
  onToggleKiosk: () => void;
  onToggleNight: () => void;
}

/** A mode is only worth showing when it is on; an always-lit row is noise. */
function Mode({
  on, label, title, onClick,
}: {
  on: boolean;
  label: string;
  title: string;
  onClick?: () => void;
}) {
  if (!on) return null;
  return (
    <button
      onClick={onClick}
      title={title}
      className="tag px-1.5 py-0.5"
      style={{
        background: "var(--panel-2)",
        color: "var(--warn)",
        border: "1px solid var(--line)",
        borderRadius: 2,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {label}
    </button>
  );
}

export function TopBar({
  weather, connected, offline, onBattery, kiosk, night, dataSaver, printer, pickup, holiday, timer, onTimerClear,
  layout, onOpenPalette, onToggleKiosk, onToggleNight,
}: Props) {
  const now = useNow(1000);

  return (
    <header className="panel flex items-stretch" style={{ flex: "0 0 auto" }}>
      <div
        className="flex items-center gap-3 px-4"
        style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
      >
        <span style={{ fontSize: "1.45em", lineHeight: 1, fontWeight: 900, letterSpacing: "-0.03em" }}>
          LOCAL<span style={{ opacity: 0.72, marginLeft: 1 }}>24</span>
        </span>
      </div>

      <div className="flex items-baseline gap-3 px-4 border-r" style={{ borderColor: "var(--line)" }}>
        <span className="num" style={{ fontSize: "1.6em", lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {clockTime(now)}
        </span>
        <span className="label" style={{ color: "var(--ink-faint)" }}>{longDate(now)}</span>
      </div>

      <div className="flex items-baseline gap-3 px-4 border-r" style={{ borderColor: "var(--line)" }}>
        <span className="num" style={{ fontSize: "1.6em", lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {temp(weather?.tempC ?? null)}
        </span>
        <span className="label truncate" style={{ maxWidth: "22ch" }}>
          {weather?.condition || "—"}
        </span>
        {weather?.feelsLikeC !== null && weather?.feelsLikeC !== undefined && (
          <span className="label">FEELS {temp(weather.feelsLikeC)}</span>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2 px-3">
        {/* Arranging windows sits with the mode chips: it is a mode too. */}
        <TimerChip timer={timer} now={now} onClear={onTimerClear} />
        {pickup && <BinsChip pickup={pickup} now={now} />}
        {holiday && <HolidayChip holiday={holiday} now={now} />}
        {printer && <PrinterChip />}
        <LayoutMenu {...layout} />
        <DisplayButton />
        <QuitButton />

        {/* Every non-default mode is visible and clickable, so it is obvious
            why the screen is behaving differently. */}
        <Mode on={kiosk} label="◱ KIOSK" title="Kiosk mode — press K to exit" onClick={onToggleKiosk} />
        <Mode on={night} label="☾ NIGHT" title="Night mode — press N to exit" onClick={onToggleNight} />
        <Mode on={dataSaver} label="↓ DATA" title="Data saver: video paused, cameras slowed" />
        <Mode on={onBattery} label="⚡ BATTERY" title="On battery — polling slowed to save power" />
        {offline ? (
          <span className="label" style={{ color: "var(--warn)" }}>OFFLINE</span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="live-dot" style={{ opacity: connected ? 1 : 0.3 }} />
            <span className="label">{connected ? "LIVE" : "POLLING"}</span>
          </span>
        )}
        <button
          onClick={onOpenPalette}
          className="tag px-2 py-1 border"
          style={{ borderColor: "var(--line)", borderRadius: 2, color: "var(--ink-faint)" }}
          title="Command palette (Ctrl+K)"
        >
          ⌘K
        </button>
      </div>
    </header>
  );
}

/**
 * Closes the kiosk window, the camera bridge and the server together.
 *
 * Two clicks rather than one: this is a full-screen kiosk, and a single
 * mis-click on a shutdown button is a bad afternoon.
 */
function QuitButton() {
  const [armed, setArmed] = useState(false);
  const [stuck, setStuck] = useState(false);

  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        className="tag px-1.5 py-0.5"
        title="Shut everything down"
        style={{
          background: "var(--panel-2)",
          color: "var(--ink-faint)",
          border: "1px solid var(--line)",
          borderRadius: 2,
        }}
      >
        ⏻
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => {
          void fetch("/api/quit", { method: "POST" }).catch(() => undefined);
          // The server is going away, so there will be no response to render.
          setTimeout(() => window.close(), 600);
          // Still here: the server was already gone (so nothing closed the
          // browser) and Chrome will not let the page close itself. Say how.
          setTimeout(() => setStuck(true), 2500);
        }}
        className="tag px-1.5 py-0.5"
        title="Close the kiosk and stop the server"
        style={{ background: "var(--accent)", color: "var(--accent-ink)", borderRadius: 2 }}
      >
        {stuck ? "⏻ PRESS ALT+F4" : "⏻ QUIT"}
      </button>
      <button
        onClick={() => setArmed(false)}
        className="tag px-1 py-0.5"
        title="Never mind"
        style={{ background: "var(--panel-2)", color: "var(--ink-dim)", borderRadius: 2 }}
      >
        ✕
      </button>
    </span>
  );
}

/**
 * Sends the window to the next monitor.
 *
 * A page cannot move itself between displays, so this asks the server, which
 * has the window handle. With one monitor attached it says so rather than
 * appearing to do nothing.
 */
function DisplayButton() {
  const [note, setNote] = useState<string | null>(null);

  const move = async () => {
    setNote("…");
    try {
      const r = (await fetch("/api/display", { method: "POST" }).then((x) => x.json())) as {
        ok?: boolean;
        single?: boolean;
      };
      setNote(r.ok ? null : r.single ? "1 screen" : "no window");
    } catch {
      setNote("failed");
    }
    setTimeout(() => setNote(null), 2500);
  };

  return (
    <button
      onClick={() => void move()}
      className="tag px-1.5 py-0.5"
      title="Move LOCAL 24 to the next monitor"
      style={{
        background: "var(--panel-2)",
        color: "var(--ink-dim)",
        border: "1px solid var(--line)",
        borderRadius: 2,
      }}
    >
      ⧉{note ? ` ${note}` : ""}
    </button>
  );
}

/** How long a finished or failed print stays mentioned up here. */
const ENDED_SHOWN_MS = 2 * 60 * 60 * 1000;

/**
 * Print progress, only while there is something to say.
 *
 * Hidden when the printer is idle; while printing it reads "53% · 20h 43m";
 * for a couple of hours after a print ends it says so. Clicking it opens the
 * printer page in the carousel.
 */
function PrinterChip() {
  const [view, setView] = useState<PrinterView | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      void fetch("/api/printer", { cache: "no-store" })
        .then((r) => r.json())
        .then((v: PrinterView) => {
          if (!cancelled) setView(v);
        })
        .catch(() => undefined);
    poll();
    // The first ask is what opens the connection to the printer, so it comes
    // back empty; a quick second look fills the chip in without a 20 s wait.
    const soon = setTimeout(poll, 3000);
    const t = setInterval(poll, 20_000);
    return () => {
      cancelled = true;
      clearTimeout(soon);
      clearInterval(t);
    };
  }, []);

  // A print finishing while the screen is up gets a notice in the corner —
  // silent, by request, but hard to miss. Only a change seen live counts, so
  // reopening the dashboard after the fact does not announce it again.
  const lastState = useRef<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; file: string } | null>(null);
  const state = view?.status?.state ?? null;
  useEffect(() => {
    const before = lastState.current;
    lastState.current = state;
    const wasActive = before === "RUNNING" || before === "PAUSE" || before === "PREPARE";
    if (wasActive && (state === "FINISH" || state === "FAILED")) {
      setToast({ ok: state === "FINISH", file: view?.status?.file ?? "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 10 * 60_000);
    return () => clearTimeout(t);
  }, [toast]);

  const s = view?.status;
  const notice = toast && (
    <button
      className={`print-toast${toast.ok ? "" : " print-toast-bad"}`}
      onClick={() => setToast(null)}
      title="Dismiss"
    >
      <span className="tag">{toast.ok ? "PRINT FINISHED" : "PRINT FAILED"}</span>
      <span className="print-toast-file">{toast.file || "Your print"}</span>
      <span className="label" style={{ color: "rgba(255,255,255,0.6)" }}>click to dismiss</span>
    </button>
  );
  if (!s) return notice || null;
  const active = s.state === "RUNNING" || s.state === "PREPARE" || s.state === "PAUSE";
  const ended = (s.state === "FINISH" || s.state === "FAILED") && Date.now() - (view?.endedAt ?? 0) < ENDED_SHOWN_MS;
  if (!active && !ended) return notice || null;

  // When it will be done, as a time on the clock: "done 9:41p" answers the
  // real question ("can I take it off before bed?") better than "4h 53m".
  const doneAt = s.remainingMin !== null && s.remainingMin > 0 ? Date.now() + s.remainingMin * 60_000 : null;
  const text = active
    ? `${s.state === "PAUSE" ? "PAUSED " : ""}${s.percent ?? 0}% · ${doneAt && s.state !== "PAUSE" ? `done ${shortTime(doneAt).replace(/\s?([ap])\.?m\.?/i, "$1").toLowerCase()}` : duration(s.remainingMin)}`
    : s.state === "FINISH" ? "PRINT DONE" : "PRINT FAILED";
  const tone = s.state === "FAILED" || s.errorCode ? "var(--accent)" : ended ? "var(--ok)" : "var(--ink)";

  return (
    <>
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("local24:carousel-goto", { detail: "printer" }))}
      className="tag px-1.5 py-0.5 num"
      title={`${s.file}${s.layer && s.totalLayers ? ` · layer ${s.layer}/${s.totalLayers}` : ""}${active ? ` · ${duration(s.remainingMin)} left` : ""} — open the printer page`}
      style={{ background: "var(--panel-2)", color: tone, border: "1px solid var(--line)", borderRadius: 2 }}
    >
      ▣ {text}
    </button>
    {notice}
    </>
  );
}

/**
 * "Bins out tonight", only when it matters: from mid-afternoon the day before
 * until late morning on the day. The rest of the week the weather panel's
 * Bins cell carries it quietly.
 */
function BinsChip({ pickup, now }: { pickup: Pickup; now: number }) {
  const when = binsReminder(pickup.date, now);
  if (!when) return null;
  return (
    <span
      className="tag px-1.5 py-0.5"
      title={pickup.items.join(", ")}
      style={{ background: "var(--panel-2)", color: "var(--warn)", border: "1px solid var(--line)", borderRadius: 2 }}
    >
      BINS {when === "tonight" ? "TONIGHT" : "TODAY"} · {pickup.items.join(" + ")}
    </span>
  );
}

/**
 * A kitchen timer, set from the command palette or with T. Counts down in the
 * bar and flashes when it is up — silently, by request. Click to clear.
 */
function TimerChip({
  timer, now, onClear,
}: {
  timer: { endsAt: number; label: string } | null;
  now: number;
  onClear: () => void;
}) {
  if (!timer) return null;
  const left = Math.ceil((timer.endsAt - now) / 1000);
  const done = left <= 0;
  const mm = Math.floor(Math.max(0, left) / 60);
  const ss = String(Math.max(0, left) % 60).padStart(2, "0");
  return (
    <button
      onClick={onClear}
      className={`tag px-1.5 py-0.5 num${done ? " timer-done" : ""}`}
      title={done ? "Timer finished. Click to dismiss" : "Click to cancel the timer"}
      style={{
        background: done ? "var(--accent)" : "var(--panel-2)",
        color: done ? "var(--accent-ink)" : "var(--ink)",
        border: "1px solid var(--line)",
        borderRadius: 2,
      }}
    >
      ⏱ {done ? `${timer.label} DONE` : `${mm}:${ss}`}
    </button>
  );
}

/**
 * A holiday coming up: from two days out, and on the day. The TTC runs a
 * Sunday schedule and most stores close, which is the useful part to know.
 */
function HolidayChip({ holiday, now }: { holiday: { date: string; name: string }; now: number }) {
  const n = daysUntil(holiday.date, now);
  if (n < 0 || n > 2) return null;
  const when = n === 0 ? "TODAY" : n === 1 ? "TOMORROW" : new Date(holiday.date + "T12:00").toLocaleDateString("en-CA", { weekday: "short" }).toUpperCase();
  return (
    <span
      className="tag px-1.5 py-0.5"
      title={`${holiday.name}: TTC on Sunday service, most stores closed`}
      style={{ background: "var(--panel-2)", color: "var(--cool)", border: "1px solid var(--line)", borderRadius: 2 }}
    >
      {n === 0 ? "HOLIDAY" : `HOLIDAY ${when}`} · {holiday.name}
    </span>
  );
}
