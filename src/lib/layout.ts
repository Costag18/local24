import type { PanelId } from "./types";

/**
 * Everything that can occupy a layout slot. The rotating panel is one option;
 * each of its panels can also be pinned into a slot of its own, which is how
 * you keep the fight card or TTC alerts permanently on screen.
 */
export const SECTION_IDS = [
  "video",
  "panels",
  "weather",
  "map",
  "cameras",
  "homecams",
  "fights",
  "events",
  "printer",
  "radar",
  "market",
  "ideas",
  "sellers",
  "leads",
  "print3d",
  "tech",
  "traffic",
  "transit",
  "crime",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export interface SectionSlot {
  /**
   * One or two sections. Two are rendered side by side in the same row, which
   * is how the map and the cameras sit next to each other.
   */
  ids: SectionId[];
  /** Share of the column's leftover height. 0 means "size to content". */
  flex: number;
  /**
   * Relative widths within the row, one per section. Omitted means equal.
   * A narrow strip beside a wide panel needs something like [3, 1].
   */
  ratio?: number[];
}

export interface Layout {
  left: SectionSlot[];
  right: SectionSlot[];
}

export const SECTION_LABELS: Record<SectionId, string> = {
  video: "Channel (video)",
  panels: "Rotating panel",
  weather: "Weather",
  map: "Live map",
  cameras: "Cameras",
  homecams: "Home cameras",
  fights: "Fight cards",
  events: "Local events",
  printer: "3D printer",
  radar: "Weather radar",
  market: "Marketplace",
  ideas: "Print ideas",
  sellers: "Selling now",
  leads: "Print requests",
  print3d: "3D printing news",
  tech: "Tech news",
  traffic: "Traffic",
  transit: "TTC alerts",
  crime: "Local crime",
};

/** Sections that are really one of the rotating panel's pages, pinned open. */
export const PANEL_SECTIONS: Record<string, PanelId> = {
  fights: "fights",
  events: "events",
  printer: "printer",
  radar: "radar",
  market: "market",
  ideas: "ideas",
  sellers: "sellers",
  leads: "leads",
  print3d: "print3d",
  tech: "tech",
  traffic: "traffic",
  transit: "transit",
  crime: "crime",
};

export function isSectionId(v: unknown): v is SectionId {
  return typeof v === "string" && (SECTION_IDS as readonly string[]).includes(v);
}

export const DEFAULT_LAYOUT: Layout = {
  left: [
    // The video pane is sized for a true 16:9, so it takes no flex share.
    { ids: ["video"], flex: 0 },
    { ids: ["panels"], flex: 1 },
  ],
  right: [
    // Home cameras sit as a narrow strip beside the weather.
    { ids: ["weather", "homecams"], flex: 0, ratio: [1.9, 1] },
    // Buses and street cameras share a row, side by side.
    { ids: ["map", "cameras"], flex: 1 },
  ],
};

/**
 * Repairs whatever is in the config file: drops unknown ids, removes repeats,
 * clamps flex, and guarantees something is rendered. A hand-edited layout
 * should never be able to produce a blank screen.
 */
export function normalizeLayout(raw: unknown): Layout {
  const column = (v: unknown, seen: Set<SectionId>): SectionSlot[] => {
    if (!Array.isArray(v)) return [];
    const out: SectionSlot[] = [];
    for (const entry of v) {
      const e = entry as { id?: unknown; ids?: unknown; flex?: unknown; ratio?: unknown };
      // `id` is the older single-section shape; both are accepted.
      const raw = Array.isArray(e?.ids) ? e.ids : [e?.id];
      const ids: SectionId[] = [];
      for (const candidate of raw) {
        // At most two per row: a third would leave every panel unreadable.
        if (!isSectionId(candidate) || seen.has(candidate) || ids.length >= 2) continue;
        seen.add(candidate);
        ids.push(candidate);
      }
      if (!ids.length) continue;
      const rawFlex = Number(e?.flex);
      const flex = Number.isFinite(rawFlex) ? Math.max(0, Math.min(6, rawFlex)) : 1;

      // A ratio only means something when it covers every section in the row.
      const rawRatio = Array.isArray(e?.ratio) ? e.ratio : null;
      const ratio =
        rawRatio && rawRatio.length === ids.length
          ? rawRatio.map((n: unknown) => {
              const v = Number(n);
              return Number.isFinite(v) && v > 0 ? Math.min(8, v) : 1;
            })
          : undefined;

      out.push(ratio ? { ids, flex, ratio } : { ids, flex });
    }
    return out;
  };

  const seen = new Set<SectionId>();
  const left = column((raw as Layout)?.left, seen);
  const right = column((raw as Layout)?.right, seen);

  if (!left.length && !right.length) return DEFAULT_LAYOUT;
  // One empty column is fine, but not a column with nothing to stretch.
  if (!left.length) return { left: right, right: [] };
  return { left, right };
}

/** True when the 16:9 solve applies: the video leads the left column. */
export function usesSixteenNineSolve(layout: Layout): boolean {
  return layout.left[0]?.ids[0] === "video";
}

/**
 * A slot's flex style. `flex: 0` means content-sized, which is what lets the
 * weather panel shrink and the panels beneath it rise.
 */
export function slotStyle(slot: SectionSlot): React.CSSProperties {
  return slot.flex === 0
    ? { flex: "0 0 auto", display: "grid", minWidth: 0 }
    : { flex: `${slot.flex} 1 0`, minHeight: 0, display: "grid", minWidth: 0 };
}
