"use client";

import { useRef, useState } from "react";
import { SECTION_IDS, SECTION_LABELS, type SectionId } from "@/lib/layout";
import type { PanelId } from "@/lib/types";
import { unusedSections, type PaneNode, type SplitPane } from "@/lib/panes";
import { Section, type SectionContext } from "./SectionHost";

export interface PaneActions {
  setRatio: (splitId: string, ratio: number) => void;
  splitLeaf: (leafId: string, dir: "row" | "col") => void;
  closeLeaf: (leafId: string) => void;
  setSection: (leafId: string, section: SectionId) => void;
  toggleLock: (leafId: string) => void;
  /** Steps this window's own content scale. */
  nudgeScale: (leafId: string, delta: number) => void;
  resetScale: (leafId: string) => void;
  flip: (splitId: string) => void;
  swap: (splitId: string) => void;
  move: (fromId: string, toId: string, side: "left" | "right" | "top" | "bottom") => void;
  /** Adds or removes a page from the rotating window's carousel. */
  togglePanel: (panel: PanelId) => void;
}

/** Every page the rotating window can cycle through. */
const PANEL_PAGES: PanelId[] = ["fights", "tech", "events", "market", "ideas", "sellers", "leads", "print3d", "radar", "printer", "traffic", "transit", "crime"];

/** Lets a child ask its parent divider to give it a particular aspect. */
export type FitAspect = (index: 0 | 1, aspect: number, chromePx: number) => void;

interface Props {
  node: PaneNode;
  root: PaneNode;
  ctx: SectionContext;
  /** Pages currently in the carousel, so the editor can show what is on. */
  panels: PanelId[];
  /** Window chrome — pickers, split, close — only appears while editing. */
  editing: boolean;
  actions: PaneActions;
  /** Supplied by the parent split, absent at the root. */
  fitAspect?: FitAspect;
  index?: 0 | 1;
}

export function PaneTree({ node, root, ctx, panels, editing, actions, fitAspect, index }: Props) {
  if (node.kind === "leaf") {
    return (
      <Leaf
        node={node} root={root} ctx={ctx} panels={panels} editing={editing} actions={actions}
        fitAspect={fitAspect} index={index}
      />
    );
  }
  return <Split node={node} root={root} ctx={ctx} panels={panels} editing={editing} actions={actions} />;
}

/**
 * A divider you can drag at any time, editing or not — that is the whole point
 * of the arrangement being yours. The ratio is written straight back to the
 * tree, so a drag survives a reload.
 */
function Split({ node, root, ctx, panels, editing, actions }: Props & { node: SplitPane }) {
  const box = useRef<HTMLDivElement>(null);
  // The flag is a ref as well as state: a fast drag delivers pointermove
  // before React has re-rendered, and a state-only check drops it.
  const dragRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const row = node.dir === "row";

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }
    dragRef.current = true;
    setDragging(true);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const v = row ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    actions.setRatio(node.id, v);
  };

  /**
   * Sizes one child to an aspect by moving this divider.
   *
   * A row divider controls width, so the child's height is fixed and the
   * width follows; a column divider is the other way round. `chromePx` is the
   * pane's own header, which is not part of the picture.
   */
  const fitAspect: FitAspect = (index, aspect, chromePx) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    const want = row
      ? ((r.height - chromePx) * aspect) / r.width
      : (r.width / aspect + chromePx) / r.height;
    actions.setRatio(node.id, index === 0 ? want : 1 - want);
  };

  const end = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    setDragging(false);
  };

  return (
    <div
      ref={box}
      style={{
        display: "flex",
        flexDirection: row ? "row" : "column",
        minWidth: 0,
        minHeight: 0,
        flex: 1,
      }}
    >
      <div style={{ flex: `${node.ratio} 1 0`, minWidth: 0, minHeight: 0, display: "flex" }}>
        <PaneTree
          node={node.children[0]} root={root} ctx={ctx} panels={panels} editing={editing} actions={actions}
          fitAspect={fitAspect} index={0}
        />
      </div>

      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => actions.setRatio(node.id, 0.5)}
        title={editing ? "Drag to resize · double-click to even up" : undefined}
        style={{
          flex: "0 0 auto",
          width: row ? "var(--gap)" : "auto",
          height: row ? "auto" : "var(--gap)",
          minWidth: row ? 4 : 0,
          minHeight: row ? 0 : 4,
          cursor: row ? "col-resize" : "row-resize",
          background: dragging ? "var(--accent)" : editing ? "var(--line)" : "transparent",
          touchAction: "none",
          position: "relative",
          zIndex: 5,
        }}
      >
        {editing && (
          <div className="pane-divider-grip" style={{ pointerEvents: "none" }} />
        )}
      </div>

      <div style={{ flex: `${1 - node.ratio} 1 0`, minWidth: 0, minHeight: 0, display: "flex" }}>
        <PaneTree
          node={node.children[1]} root={root} ctx={ctx} panels={panels} editing={editing} actions={actions}
          fitAspect={fitAspect} index={1}
        />
      </div>
    </div>
  );
}

const SIDES: { side: "left" | "right" | "top" | "bottom"; style: React.CSSProperties }[] = [
  { side: "left", style: { left: 0, top: 0, bottom: 0, width: "28%" } },
  { side: "right", style: { right: 0, top: 0, bottom: 0, width: "28%" } },
  { side: "top", style: { left: "28%", right: "28%", top: 0, height: "42%" } },
  { side: "bottom", style: { left: "28%", right: "28%", bottom: 0, height: "42%" } },
];

function Leaf({
  node, root, ctx, panels, editing, actions, fitAspect, index,
}: Props & {
  node: { kind: "leaf"; id: string; section: SectionId; locked?: boolean; scale?: number };
}) {
  const [over, setOver] = useState<string | null>(null);
  const only = root.kind === "leaf";
  const spare = unusedSections(root);
  const scale = node.scale ?? 1;

  return (
    <div
      style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0, display: "grid" }}
      onDragOver={editing ? (e) => e.preventDefault() : undefined}
    >
      {/*
        Per-window scale. `zoom` is used rather than a font size because the
        sections are built from rem units, which only track the root — the
        inner box is sized at 100/scale% so it still fills the window exactly.
      */}
      {scale === 1 ? (
        <Section id={node.section} ctx={ctx} locked={node.locked === true} />
      ) : (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", display: "grid" }}>
          <div
            style={{
              zoom: scale,
              width: `${100 / scale}%`,
              height: `${100 / scale}%`,
              display: "grid",
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <Section id={node.section} ctx={ctx} locked={node.locked === true} />
          </div>
        </div>
      )}

      {editing && (
        <>
          {/* Drop zones: dragging one window onto an edge of another splits it
              there, which is how a pane gets moved rather than re-picked. */}
          {SIDES.map(({ side, style }) => (
            <div
              key={side}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(side);
              }}
              onDragLeave={() => setOver((s) => (s === side ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const from = e.dataTransfer.getData("text/pane");
                if (from) actions.move(from, node.id, side);
              }}
              style={{
                position: "absolute",
                zIndex: 6,
                background: over === side ? "rgba(225,29,46,0.35)" : "transparent",
                outline: over === side ? "1px solid var(--accent)" : "none",
                ...style,
              }}
            />
          ))}

          <div className="pane-tools">
            <span
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/pane", node.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              className="pane-tool"
              title="Drag onto another window to move this one"
              style={{ cursor: "grab" }}
            >
              ✥
            </span>

            <select
              className="pane-tool"
              value={node.section}
              onChange={(e) => actions.setSection(node.id, e.target.value as SectionId)}
              title="What this window shows"
            >
              {SECTION_IDS.map((id) => (
                <option key={id} value={id}>
                  {SECTION_LABELS[id]}
                </option>
              ))}
            </select>

            {node.section === "video" && fitAspect && index !== undefined && (
              <button
                className="pane-tool"
                onClick={() => fitAspect(index, 16 / 9, 26)}
                title="Size this window so the video is exactly 16:9"
              >
                16:9
              </button>
            )}

            <button
              className="pane-tool"
              onClick={() => actions.splitLeaf(node.id, "row")}
              title="Split left / right"
            >
              ▯▯
            </button>
            <button
              className="pane-tool"
              onClick={() => actions.splitLeaf(node.id, "col")}
              title="Split top / bottom"
            >
              ▤
            </button>
            <span className="pane-scale">
              <button
                className="pane-tool"
                onClick={() => actions.nudgeScale(node.id, -0.1)}
                title="Smaller contents in this window"
              >
                −
              </button>
              <button
                className="pane-tool"
                onClick={() => actions.resetScale(node.id)}
                title="Back to 100%"
                style={{ color: scale === 1 ? undefined : "var(--accent)" }}
              >
                {Math.round(scale * 100)}%
              </button>
              <button
                className="pane-tool"
                onClick={() => actions.nudgeScale(node.id, 0.1)}
                title="Larger contents in this window"
              >
                +
              </button>
            </span>

            <button
              className="pane-tool"
              onClick={() => actions.toggleLock(node.id)}
              title={node.locked ? "Cycling locked — click to resume" : "Lock cycling in this window"}
              style={{ color: node.locked ? "var(--accent)" : undefined }}
            >
              {node.locked ? "🔒" : "🔓"}
            </button>
            <button
              className="pane-tool"
              onClick={() => actions.closeLeaf(node.id)}
              disabled={only}
              title={only ? "The last window cannot be closed" : "Close this window"}
            >
              ✕
            </button>
          </div>

          {node.section === "panels" ? (
            /* The rotating window's own contents: which pages it cycles
               through. Clicking a page adds or drops it. */
            <div className="pane-pages">
              {PANEL_PAGES.map((p) => {
                const on = panels.includes(p);
                const last = on && panels.length <= 1;
                return (
                  <button
                    key={p}
                    className="pane-tool"
                    onClick={() => !last && actions.togglePanel(p)}
                    disabled={last}
                    title={
                      last
                        ? "The carousel needs at least one page"
                        : on
                          ? `Remove ${SECTION_LABELS[p]} from the carousel`
                          : `Add ${SECTION_LABELS[p]} to the carousel`
                    }
                    style={{
                      color: on ? "var(--accent-ink)" : "var(--ink-faint)",
                      background: on ? "var(--accent)" : "transparent",
                    }}
                  >
                    {on ? "✓ " : "+ "}
                    {SECTION_LABELS[p]}
                  </button>
                );
              })}
            </div>
          ) : (
            spare.length > 0 && (
              <div className="pane-hint" title="Split this window to add one of these">
                {spare.length} more available
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
