import { SECTION_IDS, isSectionId, type SectionId } from "./layout";

/**
 * The screen as a tree of splits, the way an editor like Blender does it.
 *
 * Every window is a leaf; every divider is a split with two children and the
 * share of space the first one takes. That is enough for any arrangement you
 * can drag out — columns, rows, a strip beside a wide pane, nested quarters —
 * without the layout code knowing anything about the sections themselves.
 */

export interface LeafPane {
  kind: "leaf";
  id: string;
  section: SectionId;
  /** Stops this window's own rotation, for a pane you want to sit and read. */
  locked?: boolean;
  /** Content scale for this window alone, 0.5–2. Absent means 1. */
  scale?: number;
}

export interface SplitPane {
  kind: "split";
  id: string;
  /** `row` puts the children side by side; `col` stacks them. */
  dir: "row" | "col";
  /** The first child's share, 0.1–0.9. */
  ratio: number;
  children: [PaneNode, PaneNode];
}

export type PaneNode = LeafPane | SplitPane;

export interface LayoutPreset {
  id: string;
  name: string;
  tree: PaneNode;
}

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;

let counter = 0;
/** Ids only have to be unique within one tree. */
export function paneId(prefix = "p"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export const leaf = (section: SectionId, locked = false): LeafPane =>
  locked ? { kind: "leaf", id: paneId("l"), section, locked } : { kind: "leaf", id: paneId("l"), section };

export const split = (dir: "row" | "col", ratio: number, a: PaneNode, b: PaneNode): SplitPane => ({
  kind: "split",
  id: paneId("s"),
  dir,
  ratio: clampRatio(ratio),
  children: [a, b],
});

export function clampScale(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  // Rounded to whole percentage points so the toolbar reads cleanly.
  return Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, n)) * 100) / 100;
}

export function clampRatio(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, n));
}

/** The arrangement "Default" restores: what the dashboard shipped with. */
export function defaultTree(): PaneNode {
  return split(
    "row",
    0.62,
    split("col", 0.62, leaf("video"), leaf("panels")),
    split(
      "col",
      // The weather reads at a glance and does not need the height; the
      // cameras and the map do.
      0.24,
      split("row", 0.66, leaf("weather"), leaf("homecams")),
      split("row", 0.5, leaf("map"), leaf("cameras")),
    ),
  );
}

/**
 * Repairs anything that comes out of the config file.
 *
 * A layout is user-editable data that can also arrive half-written from an
 * interrupted save, so every path here has to end in something renderable
 * rather than a blank screen.
 */
export function normalizeTree(raw: unknown, depth = 0): PaneNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Partial<SplitPane> & Partial<LeafPane> & { children?: unknown };

  // A split, but only when it really has two usable children. Depth is capped
  // so a cyclic or absurd file cannot lock the renderer up.
  const kids = Array.isArray(node.children) ? node.children : null;
  if (node.kind !== "leaf" && kids && depth < 12) {
    const a = normalizeTree(kids[0], depth + 1);
    const b = normalizeTree(kids[1], depth + 1);
    if (a && b) {
      return {
        kind: "split",
        id: typeof node.id === "string" && node.id ? node.id : paneId("s"),
        dir: node.dir === "col" ? "col" : "row",
        ratio: clampRatio(node.ratio),
        children: [a, b],
      };
    }
    // One good child is not a split; it is that child.
    return a ?? b;
  }

  if (!isSectionId(node.section)) return null;
  const out: LeafPane = {
    kind: "leaf",
    id: typeof node.id === "string" && node.id ? node.id : paneId("l"),
    section: node.section,
  };
  if (node.locked === true) out.locked = true;
  if (node.scale !== undefined && clampScale(node.scale) !== 1) out.scale = clampScale(node.scale);
  return out;
}

/** Normalize, or fall back to the default rather than render nothing. */
export function safeTree(raw: unknown): PaneNode {
  return normalizeTree(raw) ?? defaultTree();
}

export function leaves(node: PaneNode): LeafPane[] {
  return node.kind === "leaf" ? [node] : [...leaves(node.children[0]), ...leaves(node.children[1])];
}

/** Sections not currently on screen — what the "add a window" list offers. */
export function unusedSections(node: PaneNode): SectionId[] {
  const used = new Set(leaves(node).map((l) => l.section));
  return SECTION_IDS.filter((id) => !used.has(id));
}

function mapTree(node: PaneNode, fn: (n: PaneNode) => PaneNode | null): PaneNode | null {
  const replaced = fn(node);
  if (replaced !== node) return replaced;
  if (node.kind === "leaf") return node;
  const a = mapTree(node.children[0], fn);
  const b = mapTree(node.children[1], fn);
  if (a === node.children[0] && b === node.children[1]) return node;
  // A split that loses a child collapses into the one that is left.
  if (!a || !b) return a ?? b;
  return { ...node, children: [a, b] };
}

/** Splits one window in two; the new half shows `section`. */
export function splitLeaf(
  tree: PaneNode,
  leafId: string,
  dir: "row" | "col",
  section: SectionId,
): PaneNode {
  return (
    mapTree(tree, (n) =>
      n.kind === "leaf" && n.id === leafId ? split(dir, 0.5, n, leaf(section)) : n,
    ) ?? tree
  );
}

/** Closes a window. The last one standing cannot be closed. */
export function closeLeaf(tree: PaneNode, leafId: string): PaneNode {
  if (tree.kind === "leaf") return tree;
  return mapTree(tree, (n) => (n.kind === "leaf" && n.id === leafId ? null : n)) ?? tree;
}

export function setLeafSection(tree: PaneNode, leafId: string, section: SectionId): PaneNode {
  return (
    mapTree(tree, (n) => (n.kind === "leaf" && n.id === leafId ? { ...n, section } : n)) ?? tree
  );
}

export function setLeafLocked(tree: PaneNode, leafId: string, locked: boolean): PaneNode {
  return (
    mapTree(tree, (n) => {
      if (n.kind !== "leaf" || n.id !== leafId) return n;
      const next: LeafPane = { kind: "leaf", id: n.id, section: n.section };
      if (locked) next.locked = true;
      if (n.scale !== undefined) next.scale = n.scale;
      return next;
    }) ?? tree
  );
}

/** Scales one window's contents on its own, independent of the page size. */
export function setLeafScale(tree: PaneNode, leafId: string, scale: number): PaneNode {
  return (
    mapTree(tree, (n) => {
      if (n.kind !== "leaf" || n.id !== leafId) return n;
      const next: LeafPane = { kind: "leaf", id: n.id, section: n.section };
      if (n.locked) next.locked = true;
      const v = clampScale(scale);
      if (v !== 1) next.scale = v;
      return next;
    }) ?? tree
  );
}

export function setSplitRatio(tree: PaneNode, splitId: string, ratio: number): PaneNode {
  return (
    mapTree(tree, (n) =>
      n.kind === "split" && n.id === splitId ? { ...n, ratio: clampRatio(ratio) } : n,
    ) ?? tree
  );
}

/** Turns a divider by 90°, which is how you re-flow a corner in place. */
export function flipSplit(tree: PaneNode, splitId: string): PaneNode {
  return (
    mapTree(tree, (n) =>
      n.kind === "split" && n.id === splitId ? { ...n, dir: n.dir === "row" ? "col" : "row" } : n,
    ) ?? tree
  );
}

export function swapSplit(tree: PaneNode, splitId: string): PaneNode {
  return (
    mapTree(tree, (n) =>
      n.kind === "split" && n.id === splitId
        ? { ...n, ratio: clampRatio(1 - n.ratio), children: [n.children[1], n.children[0]] }
        : n,
    ) ?? tree
  );
}

/**
 * Moves a window onto another one, splitting the target.
 *
 * `side` is which half of the target the window lands in, so dropping on the
 * left edge puts it left of what was there.
 */
export function movePane(
  tree: PaneNode,
  fromId: string,
  toId: string,
  side: "left" | "right" | "top" | "bottom",
): PaneNode {
  if (fromId === toId) return tree;
  const moving = leaves(tree).find((l) => l.id === fromId);
  const target = leaves(tree).find((l) => l.id === toId);
  if (!moving || !target || leaves(tree).length < 2) return tree;

  const without = closeLeaf(tree, fromId);
  const dir = side === "left" || side === "right" ? "row" : "col";
  const first = side === "left" || side === "top";

  return (
    mapTree(without, (n) =>
      n.kind === "leaf" && n.id === toId
        ? first
          ? split(dir, 0.5, moving, n)
          : split(dir, 0.5, n, moving)
        : n,
    ) ?? without
  );
}
