"use client";

const KEYS: [string, string][] = [
  ["1 – 9", "Switch channel"],
  ["← →", "Previous / next channel"],
  ["↑ ↓", "Volume"],
  ["M", "Mute / unmute"],
  ["[ ]", "Previous / next panel page"],
  ["C", "Camera wall (full screen)"],
  ["P", "Pin / unpin current camera"],
  ["K", "Kiosk mode on / off"],
  ["F", "Full screen on / off"],
  ["Ctrl + K", "Command palette"],
  ["R", "Refresh all sources"],
  ["S", "Settings"],
  ["H", "Source health"],
  ["+ / −", "Font size"],
  ["N", "Night mode"],
  ["T", "Kitchen timer: +5 min each press (click it to cancel)"],
  ["Backspace", "Close an open article"],
  ["?", "This list"],
  ["Esc", "Close overlay"],
];

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center px-4"
      style={{ background: "rgba(2,4,9,0.85)" }}
      onClick={onClose}
    >
      <div className="panel" style={{ maxWidth: 460, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="slab">
          <span className="label label-accent">Keyboard</span>
          <span className="flex-1" />
          <button onClick={onClose} className="label">ESC</button>
        </div>
        <div className="flex flex-col">
          {KEYS.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center gap-3 px-4 py-2 border-b"
              style={{ borderColor: "var(--line)" }}
            >
              <span
                className="label num px-2 py-1 border"
                style={{ borderColor: "var(--line)", minWidth: "8ch", textAlign: "center" }}
              >
                {k}
              </span>
              <span className="text-sm">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
