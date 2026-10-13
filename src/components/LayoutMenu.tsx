"use client";

import { useEffect, useRef, useState } from "react";
import type { LayoutPreset } from "@/lib/panes";

interface Props {
  editing: boolean;
  onToggleEdit: () => void;
  presets: LayoutPreset[];
  onApply: (id: string) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
  onSetDefault: () => void;
  onFactory: () => void;
}

/**
 * Arrangement controls, next to the mode chips.
 *
 * Editing is a mode rather than a separate screen: the windows stay live while
 * you move them, which is the only way to judge whether an arrangement works.
 */
export function LayoutMenu({
  editing, onToggleEdit, presets, onApply, onSave, onDelete, onReset, onSetDefault, onFactory,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
    setOpen(false);
  };

  return (
    <div ref={box} className="relative flex items-center gap-1">
      <button
        onClick={onToggleEdit}
        className="tag px-1.5 py-0.5"
        title="Arrange windows — drag dividers, split, close, lock"
        style={{
          background: editing ? "var(--accent)" : "var(--panel-2)",
          color: editing ? "var(--accent-ink)" : "var(--ink-dim)",
          border: "1px solid var(--line)",
          borderRadius: 2,
        }}
      >
        ⌗ {editing ? "DONE" : "ARRANGE"}
      </button>

      <button
        onClick={() => setOpen((o) => !o)}
        className="tag px-1.5 py-0.5"
        title="Saved arrangements"
        style={{
          background: "var(--panel-2)",
          color: "var(--ink-dim)",
          border: "1px solid var(--line)",
          borderRadius: 2,
        }}
      >
        ★ LAYOUTS
      </button>

      {open && (
        <div
          className="absolute panel"
          style={{ top: "calc(100% + 4px)", right: 0, width: 230, zIndex: 40, padding: 4 }}
        >
          <button
            className="row-link label w-full text-left px-2 py-1.5"
            onClick={() => {
              onReset();
              setOpen(false);
            }}
          >
            ↺ Back to default
          </button>
          <button
            className="row-link label w-full text-left px-2 py-1.5"
            title="Make the current arrangement the one “Back to default” restores"
            onClick={() => {
              onSetDefault();
              setOpen(false);
            }}
          >
            ⌂ Set current as default
          </button>
          <button
            className="row-link label w-full text-left px-2 py-1.5"
            title="The arrangement the dashboard shipped with"
            onClick={() => {
              onFactory();
              setOpen(false);
            }}
            style={{ color: "var(--ink-faint)" }}
          >
            ⟲ Factory arrangement
          </button>

          {presets.length > 0 && <div className="rule my-1" />}

          {presets.map((p) => (
            <div key={p.id} className="flex items-center gap-1">
              <button
                className="row-link label flex-1 text-left px-2 py-1.5 truncate"
                onClick={() => {
                  onApply(p.id);
                  setOpen(false);
                }}
                title={`Switch to “${p.name}”`}
              >
                {p.name}
              </button>
              <button
                className="label px-1.5 py-1"
                onClick={() => onDelete(p.id)}
                title="Delete this arrangement"
                style={{ color: "var(--ink-faint)" }}
              >
                ✕
              </button>
            </div>
          ))}

          <div className="rule my-1" />

          <div className="flex items-center gap-1 px-1 pb-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
              placeholder="Save current as…"
              className="flex-1 px-1.5 py-1 text-sm outline-none"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)", minWidth: 0 }}
            />
            <button
              className="label px-2 py-1"
              onClick={save}
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
