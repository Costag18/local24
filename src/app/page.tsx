"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "@/components/useAppState";
import { useActivity, useBattery, useLocalStorage, useNow, usePageVisible, useReclaimFocus } from "@/components/hooks";
import { TopBar } from "@/components/TopBar";
import type { SectionContext } from "@/components/SectionHost";
import { CameraTakeover } from "@/components/CameraTakeover";
import { Ticker } from "@/components/Ticker";
import { BreakingBanner } from "@/components/BreakingBanner";
import { CommandPalette, type Command } from "@/components/CommandPalette";
import { nudgeVolume, toggleMuted } from "@/lib/player";
import { Shortcuts } from "@/components/Shortcuts";
import { Reader } from "@/components/Reader";
import { inTimeWindow } from "@/lib/format";
import type { SectionId } from "@/lib/layout";
import {
  closeLeaf, defaultTree, flipSplit, leaves, movePane, paneId, safeTree, setLeafLocked,
  setLeafScale, setLeafSection, setSplitRatio, splitLeaf, swapSplit, unusedSections,
  type LayoutPreset, type PaneNode,
} from "@/lib/panes";
import { PaneTree, type PaneActions } from "@/components/PaneTree";
import type { Camera } from "@/lib/types";

/** Carousel pages as the palette lists them. */
const PAGE_NAMES: Record<string, string> = {
  fights: "Fight cards", tech: "Tech news", events: "Local events", printer: "3D printer", radar: "Weather radar", market: "Marketplace",
  crime: "Local crime", traffic: "Traffic", transit: "TTC alerts",
};

/** How long the pointer sits still before it is hidden. */
const CURSOR_IDLE_MS = 6000;

export default function Page() {
  const { state, connected, error, refresh, reload } = useAppState();
  /**
   * Five seconds, not one.
   *
   * Nothing in the sections shows seconds — they show "3m ago", frame ages and
   * rotation timing — but a one-second tick rebuilt the section context, and
   * with it re-rendered every window on the screen, sixty times a minute. The
   * top bar keeps its own one-second clock for the actual clock.
   */
  const now = useNow(5000);
  const visible = usePageVisible();
  const onBattery = useBattery();
  // Embedded players steal keyboard focus; take it back when the cursor returns.
  useReclaimFocus();

  const cfg = state?.config ?? null;
  const active = useActivity(cfg?.ui.idleResumeMs ?? 60000);
  // A separate, much shorter idle: the cursor should vanish long before
  // anything else reacts to being left alone.
  const pointerActive = useActivity(CURSOR_IDLE_MS);

  const [kiosk, setKiosk] = useLocalStorage("local24.kiosk", false);
  const [channelId, setChannelId] = useLocalStorage<string | null>("local24.channel", null);
  const [playlistId, setPlaylistId] = useLocalStorage<string | null>("local24.playlist", null);
  const [fontScale, setFontScale] = useLocalStorage("local24.fontScale", 1);
  const [nightOverride, setNightOverride] = useLocalStorage<boolean | null>("local24.night", null);
  const [pinnedCam, setPinnedCam] = useState<string | null>(null);
  // Kept across a reload (a new build reloads the page) so a timer survives it.
  const [timer, setTimer] = useLocalStorage<{ endsAt: number; label: string } | null>("local24.timer", null);
  // The end time as of the last key press, so quick repeated presses each add
  // on rather than all reading the same not-yet-rendered value.
  const timerEnd = useRef(0);
  useEffect(() => {
    timerEnd.current = timer?.endsAt ?? 0;
  }, [timer]);
  const startTimer = useCallback(
    (minutes: number) => {
      timerEnd.current = Date.now() + minutes * 60_000;
      setTimer({ endsAt: timerEnd.current, label: `${minutes} MIN` });
    },
    [setTimer],
  );
  /** T adds five minutes: once for five, three times for fifteen. */
  const bumpTimer = useCallback(() => {
    const base = Math.max(timerEnd.current, Date.now());
    timerEnd.current = base + 5 * 60_000;
    setTimer({ endsAt: timerEnd.current, label: `${Math.round((timerEnd.current - Date.now()) / 60_000)} MIN` });
  }, [setTimer]);
  // A finished timer flashes until dismissed, but not all day.
  useEffect(() => {
    if (!timer) return;
    const t = setTimeout(() => setTimer(null), Math.max(0, timer.endsAt + 15 * 60_000 - Date.now()));
    return () => clearTimeout(t);
  }, [timer, setTimer]);
  const [takeover, setTakeover] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [dismissedBreaking, setDismissedBreaking] = useState<string | null>(null);
  const [cams, setCams] = useState<Camera[]>([]);
  const [allCams, setAllCams] = useState<Camera[]>([]);

  // The grid is measured rather than fractional, so the video area lands on a
  // true 16:9 and the other three panels take up every remaining pixel.

  // Kiosk can also be entered by URL, for a dedicated screen.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("kiosk") === "1") setKiosk(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The camera catalogue, fetched once.
   *
   * It is half a megabyte of every camera in the city, and it used to hang off
   * `cfg` — a new object on every state push — so the dashboard re-downloaded
   * it every ten seconds forever. The catalogue only changes when the cams
   * poller runs, so an hourly re-read is generous.
   */
  const [nearCams, setNearCams] = useState<Camera[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nearRes, allRes] = await Promise.all([
          fetch("/api/cams?near=1").then((r) => r.json()),
          fetch("/api/cams").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setAllCams(allRes.cams ?? []);
        setNearCams(nearRes.cams ?? []);
      } catch {
        /* the band shows its own empty state */
      }
    };
    void load();
    const t = setInterval(() => void load(), 60 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Which of them the band shows: the playlist's own ids win, and an empty
  // playlist falls back to "near me" so the band is never blank.
  const playlistKey = (
    cfg?.playlists.find((p) => p.id === playlistId) ?? cfg?.playlists[0]
  )?.camIds.join(",");

  useEffect(() => {
    if (!allCams.length && !nearCams.length) return;
    const ids = playlistKey ? playlistKey.split(",") : [];
    const byId = new Map<string, Camera>(allCams.map((c) => [c.id, c]));
    const chosen = ids.map((id) => byId.get(id)).filter((c): c is Camera => Boolean(c));
    setCams(chosen.length ? chosen : [...nearCams, ...allCams].slice(0, 24));
  }, [allCams, nearCams, playlistKey]);

  const channels = cfg?.channels ?? [];
  const currentChannel = channelId ?? channels[0]?.id ?? null;

  const stepChannel = useCallback(
    (delta: number) => {
      if (!channels.length) return;
      const i = Math.max(0, channels.findIndex((c) => c.id === currentChannel));
      setChannelId(channels[(i + delta + channels.length) % channels.length].id);
    },
    [channels, currentChannel, setChannelId],
  );

  /** Persists a channel's source, then pulls the new config straight back. */
  const setChannelRef = useCallback(
    async (id: string, ref: string) => {
      const next = channels.map((c) => (c.id === id ? { ...c, ref } : c));
      await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels: next }),
      }).catch(() => undefined);
      await reload();
    },
    [channels, reload],
  );

  // Night mode: an explicit toggle wins over the configured schedule.
  const night = useMemo(() => {
    if (nightOverride !== null) return nightOverride;
    return inTimeWindow(cfg?.ui.nightModeFrom ?? null, cfg?.ui.nightModeTo ?? null, new Date(now));
  }, [nightOverride, cfg, now]);

  /** Window-arranging mode: chrome on every pane, dividers highlighted. */
  const [editing, setEditing] = useState(false);

  // Document-level flags drive the CSS: theme, density, kiosk, burn-in, night.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = cfg?.ui.theme ?? "cp24";
    el.dataset.density = cfg?.ui.density ?? "comfortable";
    el.dataset.kiosk = kiosk ? "1" : "0";
    el.dataset.active = active ? "1" : "0";
    el.dataset.idle = pointerActive ? "0" : "1";
    el.dataset.editing = editing ? "1" : "0";
    el.dataset.night = night ? "1" : "0";
    el.dataset.burnin = kiosk && (cfg?.ui.burnInProtection ?? true) ? "1" : "0";
    el.style.setProperty("--font-scale", String(fontScale));
    if (cfg?.ui.accent) el.style.setProperty("--accent", cfg.ui.accent);
  }, [cfg, kiosk, active, pointerActive, night, fontScale, editing]);

  // Global keys. Ignored while typing in the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      if (/^[1-9]$/.test(e.key) && !takeover) {
        const ch = channels[Number(e.key) - 1];
        if (ch) setChannelId(ch.id);
        return;
      }
      switch (e.key.toLowerCase()) {
        case "arrowright": stepChannel(1); break;
        case "arrowleft": stepChannel(-1); break;
        case "arrowup": e.preventDefault(); nudgeVolume(10); break;
        case "arrowdown": e.preventDefault(); nudgeVolume(-10); break;
        case "m": toggleMuted(); break;
        case "c": setTakeover((t) => !t); break;
        // Only the camera band knows which camera is showing, so it does the pinning.
        case "p": window.dispatchEvent(new Event("local24:pin-toggle")); break;
        case "[": window.dispatchEvent(new CustomEvent("local24:carousel-step", { detail: -1 })); break;
        case "]": window.dispatchEvent(new CustomEvent("local24:carousel-step", { detail: 1 })); break;
        case "f":
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else void document.documentElement.requestFullscreen().catch(() => undefined);
          break;
        case "k": setKiosk(!kiosk); break;
        case "r": void refresh(); break;
        case "n": setNightOverride(night ? false : true); break;
        case "t": bumpTimer(); break;
        case "s": window.location.href = "/settings"; break;
        case "h": window.location.href = "/health"; break;
        case "+": case "=": setFontScale(Math.min(1.8, Number((fontScale + 0.1).toFixed(2)))); break;
        case "-": setFontScale(Math.max(0.7, Number((fontScale - 0.1).toFixed(2)))); break;
        case "?": setHelp((h) => !h); break;
        case "escape": setHelp(false); setPalette(false); setTakeover(false); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [channels, stepChannel, kiosk, setKiosk, refresh, night, setNightOverride, fontScale, setFontScale, takeover, setChannelId, bumpTimer]);

  const dataSaver = cfg?.power.dataSaver ?? false;
  const camRefresh = dataSaver
    ? (cfg?.power.dataSaverCamRefreshMs ?? 20000)
    : onBattery && (cfg?.power.batterySaver ?? true)
      ? (cfg?.camRefreshMs ?? 5000) * 3
      : (cfg?.camRefreshMs ?? 5000);

  /**
   * The window arrangement.
   *
   * Edits are applied locally first and written back on a short delay: a
   * divider drag fires continuously, and every frame of it must not become a
   * request.
   */
  const [treeDraft, setTreeDraft] = useState<PaneNode | null>(null);
  const tree = treeDraft ?? cfg?.layoutTree ?? defaultTree();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const postConfig = useCallback(
    (patch: Record<string, unknown>) =>
      fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => undefined),
    [],
  );

  /** Debounced: a divider drag fires continuously and must not flood the API. */
  const writeConfig = useCallback(
    (patch: Record<string, unknown>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void postConfig(patch), 400);
    },
    [postConfig],
  );

  /** For edits the UI has to see straight away, like the preset list. */
  const commitConfig = useCallback(
    async (patch: Record<string, unknown>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await postConfig(patch);
      await reload();
    },
    [postConfig, reload],
  );

  const applyTree = useCallback(
    (next: PaneNode) => {
      setTreeDraft(next);
      writeConfig({ layoutTree: next });
    },
    [writeConfig],
  );

  const paneActions = useMemo<PaneActions>(
    () => ({
      setRatio: (id, r) => setTreeDraft((t) => {
        const next = setSplitRatio(t ?? tree, id, r);
        writeConfig({ layoutTree: next });
        return next;
      }),
      splitLeaf: (id, dir) => {
        // The new half shows something that is not already on screen.
        const spare = unusedSections(tree);
        applyTree(splitLeaf(tree, id, dir, spare[0] ?? "panels"));
      },
      closeLeaf: (id) => applyTree(closeLeaf(tree, id)),
      setSection: (id, section: SectionId) => applyTree(setLeafSection(tree, id, section)),
      toggleLock: (id) => {
        const leafNode = leaves(tree).find((l) => l.id === id);
        applyTree(setLeafLocked(tree, id, !leafNode?.locked));
      },
      nudgeScale: (id, delta) => {
        const current = leaves(tree).find((l) => l.id === id)?.scale ?? 1;
        applyTree(setLeafScale(tree, id, current + delta));
      },
      resetScale: (id) => applyTree(setLeafScale(tree, id, 1)),
      flip: (id) => applyTree(flipSplit(tree, id)),
      swap: (id) => applyTree(swapSplit(tree, id)),
      move: (from, to, side) => applyTree(movePane(tree, from, to, side)),
      togglePanel: (panel) => {
        const current = cfg?.panels ?? [];
        const next = current.includes(panel)
          ? current.filter((p) => p !== panel)
          : [...current, panel];
        if (!next.length) return; // the carousel must keep a page
        void commitConfig({ panels: next });
      },
    }),
    [tree, applyTree, writeConfig, cfg, commitConfig],
  );

  const presets = cfg?.layoutPresets ?? [];

  const layoutMenu = useMemo(
    () => ({
      editing,
      onToggleEdit: () => setEditing((e) => !e),
      presets,
      onApply: (id: string) => {
        const hit = presets.find((p) => p.id === id);
        if (hit) applyTree(safeTree(hit.tree));
      },
      onSave: (name: string) => {
        // Saving under an existing name replaces it, which is what "save" means
        // when the name is the thing you picked.
        const next: LayoutPreset[] = [
          ...presets.filter((p) => p.name !== name),
          { id: paneId("preset"), name, tree },
        ];
        void commitConfig({ layoutPresets: next });
      },
      onDelete: (id: string) => {
        void commitConfig({ layoutPresets: presets.filter((p) => p.id !== id) });
      },
      // "Default" is whatever the user last called default, not mine.
      onReset: () => applyTree(safeTree(cfg?.layoutDefault)),
      onSetDefault: () => void commitConfig({ layoutDefault: tree }),
      // Applies the arrangement the dashboard shipped with, without touching
      // whatever the user has saved as *their* default.
      onFactory: () => applyTree(defaultTree()),
    }),
    [editing, presets, tree, applyTree, commitConfig, cfg],
  );

  const sectionCtx = useMemo<SectionContext | null>(
    () =>
      state && cfg
        ? {
            state, now, visible, dataSaver, camRefresh, cams,
            channelId: currentChannel,
            setChannelId,
            setChannelRef,
            pinnedCam,
            setPinnedCam,
            onExpandCameras: () => setTakeover(true),
          }
        : null,
    [state, cfg, now, visible, dataSaver, camRefresh, cams,
     currentChannel, setChannelId, setChannelRef, pinnedCam],
  );

  const paletteCommands = useMemo<Command[]>(
    () => [
      { id: "act:refresh", group: "Action", label: "Refresh all sources", run: () => void refresh() },
      { id: "act:kiosk", group: "Action", label: "Toggle kiosk mode", run: () => setKiosk(!kiosk) },
      { id: "act:wall", group: "Action", label: "Open camera wall", run: () => setTakeover(true) },
      { id: "act:night", group: "Action", label: "Toggle night mode", run: () => setNightOverride(!night) },
      { id: "act:settings", group: "Action", label: "Settings", run: () => (window.location.href = "/settings") },
      { id: "act:health", group: "Action", label: "Source health", run: () => (window.location.href = "/health") },
      ...[1, 3, 5, 10, 15, 20, 30, 45, 60].map((m) => ({
        id: `timer:${m}`,
        group: "Timer",
        label: `Timer ${m} min`,
        run: () => startTimer(m),
      })),
      ...(timer ? [{ id: "timer:off", group: "Timer", label: "Cancel timer", run: () => setTimer(null) }] : []),
      // Every carousel page, by name — quicker than waiting for it to come round.
      ...(cfg?.panels ?? []).map((p) => ({
        id: `page:${p}`,
        group: "Page",
        label: PAGE_NAMES[p] ?? p,
        run: () => window.dispatchEvent(new CustomEvent("local24:carousel-goto", { detail: p })),
      })),
      ...(cfg?.playlists ?? []).map((p) => ({
        id: `pl:${p.id}`,
        group: "Playlist",
        label: p.label,
        run: () => setPlaylistId(p.id),
      })),
    ],
    [refresh, kiosk, setKiosk, night, setNightOverride, cfg, setPlaylistId, startTimer, timer, setTimer],
  );

  if (!state || !cfg || !sectionCtx) {
    return (
      <div className="grid place-items-center h-screen">
        <div className="text-center">
          <div className="font-black" style={{ fontSize: "2em", letterSpacing: "-0.02em" }}>
            LOCAL<span style={{ color: "var(--accent)" }}>24</span>
          </div>
          <div className="label" style={{ marginTop: 8 }}>
            {error ? `Connecting… (${error})` : "Starting up…"}
          </div>
        </div>
      </div>
    );
  }

  const breakingId = state.weather?.data.warnings?.[0]?.title ?? state.breaking[0]?.id ?? null;

  return (
    <>
      <div className="shell">
        <TopBar
          weather={state.weather?.data ?? null}
          connected={connected}
          offline={Boolean(error)}
          onBattery={onBattery}
          kiosk={kiosk}
          night={night}
          dataSaver={dataSaver}
          printer={Boolean(cfg.printer.host && cfg.printer.serial)}
          pickup={state.pickup?.next[0] ?? null}
          timer={timer}
          onTimerClear={() => setTimer(null)}
          layout={layoutMenu}
          onOpenPalette={() => setPalette(true)}
          onToggleKiosk={() => setKiosk(!kiosk)}
          onToggleNight={() => setNightOverride(!night)}
        />

        <BreakingBanner
          closures={state.breaking}
          weather={state.weather?.data ?? null}
          chimeEnabled={cfg.ui.chimeOnAlert}
          dndFrom={cfg.ui.dndFrom}
          dndTo={cfg.ui.dndTo}
          dismissed={dismissedBreaking !== null && dismissedBreaking === breakingId}
          onDismiss={() => setDismissedBreaking(breakingId)}
        />

        {/*
          The screen is a tree of splits: every window is a leaf and every
          divider is a node the user can drag. Nothing here knows what a
          section is — see lib/panes.ts.
        */}
        <main className="flex" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          <PaneTree
            node={tree}
            root={tree}
            ctx={sectionCtx}
            panels={cfg.panels}
            editing={editing}
            actions={paneActions}
          />
        </main>

        <Ticker
          tech={state.tech}
          local={state.local}
          crime={state.crime}
          traffic={state.traffic.data}
          custom={cfg.ticker.custom}
          mix={cfg.ticker.mix}
          speed={cfg.ticker.speed}
        />
      </div>

      {takeover && (
        <CameraTakeover
          cams={cams}
          refreshMs={camRefresh}
          dwellMs={cfg.camBandDwellMs}
          onClose={() => setTakeover(false)}
        />
      )}

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        channels={channels}
        cams={allCams}
        extra={paletteCommands}
        onChannel={setChannelId}
        onCam={(id) => {
          setPinnedCam(id);
          setCams((prev) => (prev.some((c) => c.id === id) ? prev : [...allCams.filter((c) => c.id === id), ...prev]));
        }}
      />

      <Shortcuts open={help} onClose={() => setHelp(false)} />

      {/* Outside links open here rather than in a tab the kiosk cannot leave. */}
      <Reader />
    </>
  );
}
