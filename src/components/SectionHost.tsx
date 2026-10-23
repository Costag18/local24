"use client";

import { memo } from "react";
import { MainPane } from "./MainPane";
import { WeatherRail } from "./WeatherRail";
import { CyclePanel } from "./CyclePanel";
import { CameraBand } from "./CameraBand";
import { TransitMap } from "./TransitMap";
import { HomeCams } from "./HomeCams";
import { RadarPanel } from "./RadarPanel";
import { PrinterPanel } from "./PrinterPanel";
import { Rotator } from "./Rotator";
import { TransitBoard } from "./TransitBoard";
import { PANEL_SECTIONS, type SectionId } from "@/lib/layout";
import type { AppState } from "@/lib/state";
import type { Camera, PanelId } from "@/lib/types";

export interface SectionContext {
  state: AppState;
  now: number;
  visible: boolean;
  dataSaver: boolean;
  camRefresh: number;
  cams: Camera[];
  channelId: string | null;
  setChannelId: (id: string) => void;
  setChannelRef: (id: string, ref: string) => Promise<void>;
  pinnedCam: string | null;
  setPinnedCam: (id: string | null) => void;
  onExpandCameras: () => void;
}

/**
 * Renders one layout slot. Every section is addressed by id, so the layout is
 * data rather than markup — reordering or swapping a section is a config
 * change, not a code change.
 */
function SectionInner({
  id, ctx, locked = false,
}: {
  id: SectionId;
  ctx: SectionContext;
  /** This window's cycling is held still by the user. */
  locked?: boolean;
}) {
  const { state, now, visible, dataSaver, camRefresh, cams } = ctx;
  const cfg = state.config;

  switch (id) {
    case "video":
      return (
        <MainPane
          channels={cfg.channels}
          activeId={ctx.channelId}
          onSelect={ctx.setChannelId}
          suspend={!visible || dataSaver}
          onSetRef={ctx.setChannelRef}
        />
      );

    case "weather":
      // Weather and the radar take turns in the same window.
      return (
        <Rotator
          dwellMs={cfg.panelDwellMs}
          locked={locked}
          pages={[
            {
              key: "weather",
              title: "Weather",
              node: (
                <WeatherRail
                  weather={state.weather?.data ?? null}
                  at={state.weather?.at ?? 0}
                  now={now}
                  pickup={state.pickup?.next[0] ?? null}
                />
              ),
            },
            { key: "radar", title: "Radar", node: <Titled name="Radar"><RadarPanel now={now} /></Titled> },
          ]}
        />
      );

    case "homecams": {
      // The home camera and the printer's own camera take turns.
      const printerOn = Boolean(cfg.printer.host && cfg.printer.serial);
      const home = { key: "home", title: "Home camera", node: <HomeCams cams={cfg.homeCams} suspend={!visible || dataSaver} /> };
      const printer = {
        key: "printer",
        title: cfg.printer.label,
        node: <Titled name={cfg.printer.label}><PrinterPanel label={cfg.printer.label} /></Titled>,
      };
      const pages = [...(cfg.homeCams.length ? [home] : []), ...(printerOn && visible ? [printer] : [])];
      return <Rotator dwellMs={cfg.panelDwellMs} locked={locked} pages={pages.length ? pages : [home]} />;
    }

    case "map":
      // The map says where the buses are; the board says when one reaches you.
      return (
        <Rotator
          locked={locked}
          dwellMs={cfg.panelDwellMs}
          pages={[
            { key: "map", title: "Live map", node: <TransitMap now={now} paused={!visible} />, dwellMs: cfg.panelDwellMs * 1.5, keep: true },
            {
              key: "board",
              title: "Next buses",
              node: (
                <TransitBoard
                  routes={cfg.map.routes}
                  paused={!visible}
                  now={now}
                  alerts={state.transit.map((t) => ({
                    route: String(t.meta?.route ?? ""),
                    title: t.title,
                    planned: t.meta?.planned === true,
                  }))}
                />
              ),
            },
          ]}
        />
      );

    case "cameras":
      return (
        <CameraBand
          cams={cams}
          videoCams={cfg.videoCams}
          camStatus={state.camStatus}
          videoDwellMs={cfg.videoCamDwellMs}
          suspendVideo={!visible || dataSaver}
          dwellMs={cfg.camBandDwellMs}
          locked={locked}
          refreshMs={visible ? camRefresh : 0}
          now={now}
          onExpand={ctx.onExpandCameras}
          pinned={ctx.pinnedCam}
          onPin={ctx.setPinnedCam}
        />
      );

    default: {
      // Everything else is the rotating panel — either cycling through the
      // configured pages, or pinned to the single page this slot names.
      const pinned: PanelId | undefined = PANEL_SECTIONS[id];
      const panels: PanelId[] = pinned ? [pinned] : cfg.panels;
      return (
        <CyclePanel
          panels={panels}
          dwellMs={cfg.panelDwellMs}
          locked={locked}
          now={now}
          tech={state.tech}
          crime={state.crime}
          traffic={state.traffic}
          transit={state.transit}
          transitPlaces={cfg.transitPlaces}
          fights={state.fights}
          events={state.events}
          market={state.market ?? []}
          sellers={state.sellers ?? { items: [], tracking: false }}
          ideas={state.ideas ?? { models: [], trends: [] }}
          print3d={state.print3d ?? []}
          leads={state.leads ?? []}
          marketLabels={Object.fromEntries(cfg.market.searches.map((s) => [s.id, s.label]))}
          printer={{ configured: Boolean(cfg.printer.host && cfg.printer.serial), label: cfg.printer.label }}
        />
      );
    }
  }
}

/** A window with a plain header, for pages that do not draw their own. */
function Titled({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="panel flex flex-col" style={{ minHeight: 0 }}>
      <div className="slab">
        <span className="label label-accent shrink-0 slab-name">{name}</span>
      </div>
      <div className="flex-1" style={{ minHeight: 0, position: "relative" }}>{children}</div>
    </section>
  );
}

/**
 * Windows only re-render when their own inputs change.
 *
 * `ctx` is one object shared by every window, so without this a new context —
 * a fresh state payload, a clock tick — re-rendered all of them, including the
 * map's several hundred SVG nodes.
 */
export const Section = memo(SectionInner);
