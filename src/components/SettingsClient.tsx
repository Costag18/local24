"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SECTION_IDS, SECTION_LABELS, normalizeLayout, type SectionId, type SectionSlot } from "@/lib/layout";
import type { AppConfig, Camera, CamPlaylist, Channel, HomeCam, PanelId } from "@/lib/types";

const PANELS: PanelId[] = ["fights", "tech", "events", "market", "ideas", "sellers", "leads", "print3d", "radar", "printer", "traffic", "transit", "crime"];

export function SettingsClient() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [cams, setCams] = useState<Camera[]>([]);
  const [camQuery, setCamQuery] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/config").then((r) => r.json()).then((c: AppConfig) => {
      setCfg(c);
      setActivePlaylist(c.playlists[0]?.id ?? null);
    });
    void fetch("/api/cams").then((r) => r.json()).then((d) => setCams(d.cams ?? []));
  }, []);

  const save = useCallback(async (patch: Partial<AppConfig>) => {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const next = (await res.json()) as AppConfig;
    setCfg(next);
    setSaved(new Date().toLocaleTimeString());
    return next;
  }, []);

  const filteredCams = useMemo(() => {
    const q = camQuery.trim().toLowerCase();
    const list = q
      ? cams.filter((c) => `${c.label} ${c.roadway} ${c.cross}`.toLowerCase().includes(q))
      : cams;
    return list.slice(0, 200);
  }, [cams, camQuery]);

  if (!cfg) return <div className="p-6 label">Loading settings…</div>;

  const playlist = cfg.playlists.find((p) => p.id === activePlaylist) ?? cfg.playlists[0] ?? null;

  const setPlaylist = (next: CamPlaylist) =>
    void save({ playlists: cfg.playlists.map((p) => (p.id === next.id ? next : p)) });

  return (
    <div className="scroll-y" style={{ height: "100vh" }}>
      <header
        className="slab sticky top-0 z-10"
        style={{ background: "var(--panel)", borderBottom: "1px solid var(--line)" }}
      >
        <span className="label label-accent">Settings</span>
        <span className="flex-1" />
        {saved && <span className="label" style={{ color: "var(--ok)" }}>saved {saved}</span>}
        <a href="/health" className="label px-2 py-1 border" style={{ borderColor: "var(--line)" }}>Health</a>
        <a href="/" className="label px-2 py-1" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
          ← Back
        </a>
      </header>

      <div className="p-4 flex flex-col gap-4" style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Section
          title="Windows"
          note="The arrangement lives on the dashboard itself."
        >
          <div className="label" style={{ color: "var(--ink-dim)", whiteSpace: "normal" }}>
            Press <strong>⌗ ARRANGE</strong> in the top bar to move, split, resize, lock or close
            windows, drag any divider at any time, and save an arrangement under <strong>★ LAYOUTS</strong>
            — which is also where “Back to default” lives.
          </div>
        </Section>

        <Section title="Location">
          <Row label="Place">
            <input
              className="inp"
              defaultValue={cfg.place.label}
              onBlur={(e) => void save({ place: { ...cfg.place, label: e.target.value } })}
            />
          </Row>
          <Row label="Latitude">
            <input
              className="inp num"
              type="number"
              step="0.0001"
              defaultValue={cfg.place.lat}
              onBlur={(e) => void save({ place: { ...cfg.place, lat: Number(e.target.value) } })}
            />
          </Row>
          <Row label="Longitude">
            <input
              className="inp num"
              type="number"
              step="0.0001"
              defaultValue={cfg.place.lon}
              onBlur={(e) => void save({ place: { ...cfg.place, lon: Number(e.target.value) } })}
            />
          </Row>
          <Row label="Nearby radius (km)">
            <input
              className="inp num"
              type="number"
              defaultValue={cfg.camRadiusKm}
              onBlur={(e) => void save({ camRadiusKm: Number(e.target.value) })}
            />
          </Row>
        </Section>

        <Section
          title="Home"
          note="Your own spot: it picks the garbage collection calendar and is marked on the radar. Right-click your house in Google Maps to copy its coordinates."
        >
          <Row label="Latitude">
            <input className="inp num" type="number" step="0.00001" defaultValue={cfg.home.lat}
              onBlur={(e) => void save({ home: { ...cfg.home, lat: Number(e.target.value) } })} />
          </Row>
          <Row label="Longitude">
            <input className="inp num" type="number" step="0.00001" defaultValue={cfg.home.lon}
              onBlur={(e) => void save({ home: { ...cfg.home, lon: Number(e.target.value) } })} />
          </Row>
          <Row label="Collection calendar">
            <input className="inp" defaultValue={cfg.pickupCalendar} placeholder="Looked up from home (e.g. Thursday2)"
              onBlur={(e) => void save({ pickupCalendar: e.target.value.trim() })} />
          </Row>
        </Section>

        <Section title="Channels" note="Paste a YouTube video, playlist, or channel /live URL — or a direct .m3u8 stream.">
          {cfg.channels.map((ch) => (
            <div key={ch.id} className="flex items-center gap-2 py-1.5 border-b" style={{ borderColor: "var(--line)" }}>
              <input
                className="inp"
                style={{ width: 150 }}
                defaultValue={ch.label}
                onBlur={(e) =>
                  void save({
                    channels: cfg.channels.map((c) => (c.id === ch.id ? { ...c, label: e.target.value } : c)),
                  })
                }
              />
              <input
                className="inp flex-1"
                placeholder="https://www.youtube.com/…"
                defaultValue={ch.ref}
                onBlur={(e) =>
                  void save({
                    channels: cfg.channels.map((c) => (c.id === ch.id ? { ...c, ref: e.target.value.trim() } : c)),
                  })
                }
              />
              <input
                type="color"
                defaultValue={ch.accent ?? "#e11d2e"}
                onBlur={(e) =>
                  void save({
                    channels: cfg.channels.map((c) => (c.id === ch.id ? { ...c, accent: e.target.value } : c)),
                  })
                }
                style={{ width: 34, height: 28, background: "transparent", border: "1px solid var(--line)" }}
              />
              <button
                className="label px-2"
                onClick={() => void save({ channels: cfg.channels.filter((c) => c.id !== ch.id) })}
                title="Remove channel"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="label px-3 py-1.5 mt-2 border self-start"
            style={{ borderColor: "var(--line)" }}
            onClick={() => {
              const id = `ch${Date.now().toString(36)}`;
              const next: Channel = { id, label: "New channel", type: "youtube", ref: "", accent: "#64748b" };
              void save({ channels: [...cfg.channels, next] });
            }}
          >
            + Add channel
          </button>
        </Section>

        <Section
          title="Home cameras"
          note="A snapshot or MJPEG URL from the camera's own web page. RTSP will not play in a browser."
        >
          {cfg.homeCams.map((hc) => (
            <div key={hc.id} className="flex items-center gap-2 py-1.5 row">
              <input
                className="inp"
                style={{ width: 130 }}
                defaultValue={hc.label}
                onBlur={(e) =>
                  void save({ homeCams: cfg.homeCams.map((c) => (c.id === hc.id ? { ...c, label: e.target.value } : c)) })
                }
              />
              <select
                className="inp"
                style={{ width: 100 }}
                defaultValue={hc.kind}
                onChange={(e) =>
                  void save({
                    homeCams: cfg.homeCams.map((c) =>
                      c.id === hc.id ? { ...c, kind: e.target.value as HomeCam["kind"] } : c,
                    ),
                  })
                }
              >
                <option value="snapshot">Snapshot</option>
                <option value="mjpeg">MJPEG</option>
                <option value="nest">Google Nest</option>
              </select>
              <input
                className="inp flex-1"
                placeholder={
                  hc.kind === "nest"
                    ? "https://home.google.com/… (this camera's page)"
                    : "http://user:pass@192.168.1.50/snapshot.jpg"
                }
                defaultValue={hc.url}
                onBlur={(e) =>
                  void save({ homeCams: cfg.homeCams.map((c) => (c.id === hc.id ? { ...c, url: e.target.value.trim() } : c)) })
                }
              />
              <input
                className="inp num"
                style={{ width: 66 }}
                type="number"
                title="Snapshot refresh, seconds"
                defaultValue={Math.round(hc.refreshMs / 1000)}
                onBlur={(e) =>
                  void save({
                    homeCams: cfg.homeCams.map((c) =>
                      c.id === hc.id ? { ...c, refreshMs: Math.max(1, Number(e.target.value)) * 1000 } : c,
                    ),
                  })
                }
              />
              <button
                className="label px-2"
                onClick={() => void save({ homeCams: cfg.homeCams.filter((c) => c.id !== hc.id) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="label px-3 py-1.5 mt-2 border self-start"
            style={{ borderColor: "var(--line)" }}
            onClick={() =>
              void save({
                homeCams: [
                  ...cfg.homeCams,
                  { id: `hc${Date.now().toString(36)}`, label: "Camera", kind: "snapshot" as const, url: "", refreshMs: 5000 },
                ],
              })
            }
          >
            + Add home camera
          </button>
          <div className="label mt-2" style={{ color: "var(--ink-faint)", whiteSpace: "normal" }}>
            Requests are proxied through this machine, so any credentials in the URL stay
            off the browser and a plain-HTTP camera still works.
          </div>
          <NestBridge />
        </Section>

        <Section
          title="Live video cameras"
          note="Neither Toronto nor Ontario 511 publishes video — both are JPEG snapshots. Real motion has to come from a live stream."
        >
          {cfg.videoCams.map((vc) => (
            <div key={vc.id} className="flex items-center gap-2 py-1.5 border-b" style={{ borderColor: "var(--line)" }}>
              <input
                className="inp"
                style={{ width: 150 }}
                defaultValue={vc.label}
                onBlur={(e) =>
                  void save({ videoCams: cfg.videoCams.map((v) => (v.id === vc.id ? { ...v, label: e.target.value } : v)) })
                }
              />
              <input
                className="inp flex-1"
                placeholder="https://www.youtube.com/watch?v=… (a live stream) or an .m3u8 URL"
                defaultValue={vc.ref}
                onBlur={(e) =>
                  void save({ videoCams: cfg.videoCams.map((v) => (v.id === vc.id ? { ...v, ref: e.target.value.trim() } : v)) })
                }
              />
              <button
                className="label px-2"
                onClick={() => void save({ videoCams: cfg.videoCams.filter((v) => v.id !== vc.id) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="label px-3 py-1.5 mt-2 border self-start"
            style={{ borderColor: "var(--line)" }}
            onClick={() =>
              void save({
                videoCams: [...cfg.videoCams, { id: `vc${Date.now().toString(36)}`, label: "New live cam", ref: "" }],
              })
            }
          >
            + Add live cam
          </button>
          <div className="label mt-2" style={{ color: "var(--ink-faint)" }}>
            Remove them all to fall back to a large snapshot camera instead.
          </div>
        </Section>

        <Section title="Camera playlists" note={`${cams.length} cameras available (City of Toronto + Ontario 511).`}>
          <div className="flex gap-2 flex-wrap mb-3">
            {cfg.playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePlaylist(p.id)}
                className="label px-2 py-1 border"
                style={{
                  borderColor: "var(--line)",
                  background: p.id === playlist?.id ? "var(--accent)" : "transparent",
                  color: p.id === playlist?.id ? "var(--accent-ink)" : "var(--ink-dim)",
                }}
              >
                {p.label} ({p.camIds.length})
              </button>
            ))}
          </div>

          {playlist && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="label" style={{ width: "9ch" }}>Dwell (s)</span>
                <input
                  className="inp num"
                  style={{ width: 80 }}
                  type="number"
                  defaultValue={Math.round(playlist.dwellMs / 1000)}
                  onBlur={(e) => setPlaylist({ ...playlist, dwellMs: Math.max(2, Number(e.target.value)) * 1000 })}
                />
                <span className="flex-1" />
                <button
                  className="label px-2 py-1 border"
                  style={{ borderColor: "var(--line)" }}
                  onClick={async () => {
                    const d = await fetch("/api/cams?near=1").then((r) => r.json());
                    setPlaylist({ ...playlist, camIds: (d.cams ?? []).map((c: Camera) => c.id) });
                  }}
                >
                  Fill from “near me”
                </button>
                <button
                  className="label px-2 py-1 border"
                  style={{ borderColor: "var(--line)" }}
                  onClick={() => setPlaylist({ ...playlist, camIds: [] })}
                >
                  Clear
                </button>
              </div>

              <input
                className="inp w-full mb-2"
                placeholder="Search cameras by street or highway…"
                value={camQuery}
                onChange={(e) => setCamQuery(e.target.value)}
              />

              <div className="scroll-y" style={{ maxHeight: 260, border: "1px solid var(--line)" }}>
                {filteredCams.map((c) => {
                  const on = playlist.camIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() =>
                        setPlaylist({
                          ...playlist,
                          camIds: on
                            ? playlist.camIds.filter((id) => id !== c.id)
                            : [...playlist.camIds, c.id],
                        })
                      }
                      className="flex items-center gap-2 w-full px-2 py-1 text-left border-b"
                      style={{ borderColor: "var(--line)", background: on ? "var(--panel-2)" : "transparent" }}
                    >
                      <span className="label" style={{ width: "2ch", color: on ? "var(--accent)" : "var(--ink-faint)" }}>
                        {on ? "✓" : "+"}
                      </span>
                      <span className="text-xs truncate flex-1">{c.label}</span>
                      <span className="label" style={{ color: "var(--ink-faint)" }}>
                        {c.network === "toronto" ? "CITY" : "511"}
                      </span>
                    </button>
                  );
                })}
                {!filteredCams.length && <div className="label p-3">No cameras match.</div>}
              </div>
            </>
          )}
        </Section>

        <Section title="Panels & rotation">
          <div className="flex gap-2 flex-wrap mb-3">
            {PANELS.map((p) => {
              const on = cfg.panels.includes(p);
              return (
                <button
                  key={p}
                  onClick={() =>
                    void save({
                      panels: on ? cfg.panels.filter((x) => x !== p) : [...cfg.panels, p],
                    })
                  }
                  className="label px-2 py-1 border"
                  style={{
                    borderColor: "var(--line)",
                    background: on ? "var(--accent)" : "transparent",
                    color: on ? "var(--accent-ink)" : "var(--ink-dim)",
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>
          <Row label="Panel dwell (s)">
            <input className="inp num" type="number" defaultValue={Math.round(cfg.panelDwellMs / 1000)}
              onBlur={(e) => void save({ panelDwellMs: Math.max(3, Number(e.target.value)) * 1000 })} />
          </Row>
          <Row label="Live cam dwell (s)">
            <input className="inp num" type="number" defaultValue={Math.round(cfg.videoCamDwellMs / 1000)}
              onBlur={(e) => void save({ videoCamDwellMs: Math.max(10, Number(e.target.value)) * 1000 })} />
          </Row>
          <Row label="Camera dwell (s)">
            <input className="inp num" type="number" defaultValue={Math.round(cfg.camBandDwellMs / 1000)}
              onBlur={(e) => void save({ camBandDwellMs: Math.max(3, Number(e.target.value)) * 1000 })} />
          </Row>
          <Row label="Camera refresh (s)">
            <input className="inp num" type="number" defaultValue={Math.round(cfg.camRefreshMs / 1000)}
              onBlur={(e) => void save({ camRefreshMs: Math.max(2, Number(e.target.value)) * 1000 })} />
          </Row>
          <Row label="Rewind buffer (frames)">
            <input className="inp num" type="number" defaultValue={cfg.camFrameBuffer}
              onBlur={(e) => void save({ camFrameBuffer: Math.max(10, Number(e.target.value)) })} />
          </Row>
        </Section>

        <Section title="News" note="Weights rank sources against each other. Boost lifts matching stories; mute removes them.">
          {Object.entries(cfg.news.weights).map(([id, w]) => (
            <Row key={id} label={id}>
              <input className="inp num" type="number" step="0.05" defaultValue={w}
                onBlur={(e) =>
                  void save({ news: { ...cfg.news, weights: { ...cfg.news.weights, [id]: Number(e.target.value) } } })
                } />
            </Row>
          ))}
          <Row label="Boost words">
            <input className="inp" defaultValue={cfg.news.boost.join(", ")}
              placeholder="rust, toronto, nvidia"
              onBlur={(e) => void save({ news: { ...cfg.news, boost: splitList(e.target.value) } })} />
          </Row>
          <Row label="Mute words">
            <input className="inp" defaultValue={cfg.news.mute.join(", ")}
              onBlur={(e) => void save({ news: { ...cfg.news, mute: splitList(e.target.value) } })} />
          </Row>
          <Row label="Crime keywords">
            <input className="inp" defaultValue={cfg.news.crimeKeywords.join(", ")}
              onBlur={(e) => void save({ news: { ...cfg.news, crimeKeywords: splitList(e.target.value) } })} />
          </Row>
        </Section>

        <Section
          title="Marketplace"
          note="New local listings from Facebook Marketplace, Kijiji and Karrot, read logged out (no account involved)."
        >
          <Toggle label="Show new listings" on={cfg.market.enabled}
            onChange={(v) => void save({ market: { ...cfg.market, enabled: v } })} />
          {(["facebook", "kijiji", "karrot"] as const).map((src) => (
            <Toggle key={src} label={`Search ${src[0].toUpperCase()}${src.slice(1)}`} on={cfg.market.sources.includes(src)}
              onChange={(v) => void save({
                market: { ...cfg.market, sources: v ? [...cfg.market.sources, src] : cfg.market.sources.filter((x) => x !== src) },
              })} />
          ))}
          <Row label="Kijiji / Karrot radius (km)">
            <input className="inp num" type="number" defaultValue={cfg.market.radiusKm}
              onBlur={(e) => void save({ market: { ...cfg.market, radiusKm: Number(e.target.value) || 25 } })} />
          </Row>
          <Row label="Facebook cities">
            <input className="inp" defaultValue={cfg.market.cities.join(", ")}
              onBlur={(e) => void save({ market: { ...cfg.market, cities: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) } })} />
          </Row>
          {cfg.market.searches.map((srch, i) => (
            <Row key={srch.id} label={`${srch.label} — search for`}>
              <input className="inp" defaultValue={srch.queries.join(", ")}
                onBlur={(e) => {
                  const searches = cfg.market.searches.map((x, j) =>
                    j === i ? { ...x, queries: e.target.value.split(",").map((q) => q.trim()).filter(Boolean) } : x);
                  void save({ market: { ...cfg.market, searches } });
                }} />
            </Row>
          ))}
        </Section>

        <Section
          title="3D printer"
          note="A Bambu Lab printer in LAN mode. The access code is on the printer's screen; it stays on this computer and is never sent to the dashboard page."
        >
          <Row label="Name">
            <input className="inp" defaultValue={cfg.printer.label}
              onBlur={(e) => void save({ printer: { ...cfg.printer, label: e.target.value || "Printer" } })} />
          </Row>
          <Row label="IP address">
            <input className="inp num" defaultValue={cfg.printer.host} placeholder="192.168.2.200"
              onBlur={(e) => void save({ printer: { ...cfg.printer, host: e.target.value.trim() } })} />
          </Row>
          <Row label="Serial number">
            <input className="inp num" defaultValue={cfg.printer.serial}
              onBlur={(e) => void save({ printer: { ...cfg.printer, serial: e.target.value.trim() } })} />
          </Row>
          <Row label="Access code">
            {/* Shows the mask; leaving it untouched keeps the stored code. */}
            <input className="inp num" type="password" defaultValue={cfg.printer.accessCode} autoComplete="off"
              onBlur={(e) => void save({ printer: { ...cfg.printer, accessCode: e.target.value.trim() } })} />
          </Row>
        </Section>

        <Section title="Traffic & transit" note="TTC alerts come from the TTC's own live feed — no stop ids needed.">
          <Row label="Routes of interest">
            <input className="inp" defaultValue={cfg.routesOfInterest.join(", ")}
              placeholder="401, DVP, GARDINER"
              onBlur={(e) => void save({ routesOfInterest: splitList(e.target.value).map((s) => s.toUpperCase()) })} />
          </Row>
        </Section>

        <Section title="Ticker" note="Proportions are normalised, so any positive numbers work.">
          <Row label="Headlines">
            <input className="inp num" type="number" step="0.05" defaultValue={cfg.ticker.mix.headlines}
              onBlur={(e) => void save({ ticker: { ...cfg.ticker, mix: { ...cfg.ticker.mix, headlines: Number(e.target.value) } } })} />
          </Row>
          <Row label="Traffic">
            <input className="inp num" type="number" step="0.05" defaultValue={cfg.ticker.mix.traffic}
              onBlur={(e) => void save({ ticker: { ...cfg.ticker, mix: { ...cfg.ticker.mix, traffic: Number(e.target.value) } } })} />
          </Row>
          <Row label="Custom">
            <input className="inp num" type="number" step="0.05" defaultValue={cfg.ticker.mix.custom}
              onBlur={(e) => void save({ ticker: { ...cfg.ticker, mix: { ...cfg.ticker.mix, custom: Number(e.target.value) } } })} />
          </Row>
          <Row label="Speed (px/s)">
            <input className="inp num" type="number" defaultValue={cfg.ticker.speed}
              onBlur={(e) => void save({ ticker: { ...cfg.ticker, speed: Math.max(10, Number(e.target.value)) } })} />
          </Row>
          <Row label="Pinned messages">
            <input className="inp" defaultValue={cfg.ticker.custom.join(" | ")}
              placeholder="Garbage day Thursday | Gym at 6"
              onBlur={(e) =>
                void save({ ticker: { ...cfg.ticker, custom: e.target.value.split("|").map((s) => s.trim()).filter(Boolean) } })
              } />
          </Row>
        </Section>

        <Section title="Appearance">
          <Row label="Theme">
            <select className="inp" defaultValue={cfg.ui.theme}
              onChange={(e) => void save({ ui: { ...cfg.ui, theme: e.target.value as AppConfig["ui"]["theme"] } })}>
              <option value="cp24">CP24 (red)</option>
              <option value="midnight">Midnight (blue)</option>
              <option value="amber">Amber</option>
            </select>
          </Row>
          <Row label="Density">
            <select className="inp" defaultValue={cfg.ui.density}
              onChange={(e) => void save({ ui: { ...cfg.ui, density: e.target.value as "comfortable" | "compact" } })}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </Row>
          <Row label="Accent">
            <input type="color" defaultValue={cfg.ui.accent}
              onBlur={(e) => void save({ ui: { ...cfg.ui, accent: e.target.value } })}
              style={{ width: 44, height: 28, background: "transparent", border: "1px solid var(--line)" }} />
          </Row>
          <Toggle label="Burn-in protection (kiosk)" on={cfg.ui.burnInProtection}
            onChange={(v) => void save({ ui: { ...cfg.ui, burnInProtection: v } })} />
          <Toggle label="Chime on alerts" on={cfg.ui.chimeOnAlert}
            onChange={(v) => void save({ ui: { ...cfg.ui, chimeOnAlert: v } })} />
          <Row label="Night mode from">
            <input className="inp num" placeholder="23:00" defaultValue={cfg.ui.nightModeFrom ?? ""}
              onBlur={(e) => void save({ ui: { ...cfg.ui, nightModeFrom: e.target.value || null } })} />
          </Row>
          <Row label="Night mode to">
            <input className="inp num" placeholder="07:00" defaultValue={cfg.ui.nightModeTo ?? ""}
              onBlur={(e) => void save({ ui: { ...cfg.ui, nightModeTo: e.target.value || null } })} />
          </Row>
          <Row label="Do not disturb">
            <span className="flex gap-2">
              <input className="inp num" style={{ width: 90 }} placeholder="23:00" defaultValue={cfg.ui.dndFrom ?? ""}
                onBlur={(e) => void save({ ui: { ...cfg.ui, dndFrom: e.target.value || null } })} />
              <input className="inp num" style={{ width: 90 }} placeholder="07:00" defaultValue={cfg.ui.dndTo ?? ""}
                onBlur={(e) => void save({ ui: { ...cfg.ui, dndTo: e.target.value || null } })} />
            </span>
          </Row>
          <Row label="Idle resume (s)">
            <input className="inp num" type="number" defaultValue={Math.round(cfg.ui.idleResumeMs / 1000)}
              onBlur={(e) => void save({ ui: { ...cfg.ui, idleResumeMs: Math.max(5, Number(e.target.value)) * 1000 } })} />
          </Row>
        </Section>

        <Section title="Power & data" note="This runs on a laptop, so polling and video back off when it matters.">
          <Toggle label="Slow polling on battery" on={cfg.power.batterySaver}
            onChange={(v) => void save({ power: { ...cfg.power, batterySaver: v } })} />
          <Toggle label="Data saver (pauses video, slows cameras)" on={cfg.power.dataSaver}
            onChange={(v) => void save({ power: { ...cfg.power, dataSaver: v } })} />
          <Row label="Data-saver cam refresh (s)">
            <input className="inp num" type="number" defaultValue={Math.round(cfg.power.dataSaverCamRefreshMs / 1000)}
              onBlur={(e) => void save({ power: { ...cfg.power, dataSaverCamRefreshMs: Math.max(5, Number(e.target.value)) * 1000 } })} />
          </Row>
        </Section>

        <Section title="Config file" note="The whole configuration is one JSON file — this is also how you move it to a server later.">
          <div className="flex gap-2 flex-wrap">
            <button
              className="label px-3 py-1.5 border"
              style={{ borderColor: "var(--line)" }}
              onClick={() => {
                const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "local24-config.json";
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              Export JSON
            </button>
            <label className="label px-3 py-1.5 border" style={{ borderColor: "var(--line)", cursor: "pointer" }}>
              Import JSON
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    await save(JSON.parse(await file.text()));
                  } catch {
                    alert("That file is not valid JSON.");
                  }
                }}
              />
            </label>
            <button
              className="label px-3 py-1.5 border"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              onClick={() => {
                if (confirm("Reset every setting to defaults? Channels and playlists will be cleared."))
                  void save({ __reset: true } as unknown as Partial<AppConfig>);
              }}
            >
              Reset to defaults
            </button>
          </div>
        </Section>
      </div>

      <style>{`
        .inp {
          background: var(--panel-2);
          border: 1px solid var(--line);
          color: var(--ink);
          padding: 5px 8px;
          font-size: 13px;
          outline: none;
          min-width: 0;
        }
        .inp:focus { border-color: var(--accent); }
      `}</style>
    </div>
  );
}

function splitList(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="slab">
        <span className="label label-accent">{title}</span>
        {note && <span className="label truncate" style={{ color: "var(--ink-faint)" }}>{note}</span>}
      </div>
      <div className="p-3 flex flex-col">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b" style={{ borderColor: "var(--line)" }}>
      <span className="label" style={{ minWidth: "20ch" }}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="flex items-center gap-3 py-1.5 border-b text-left"
      style={{ borderColor: "var(--line)" }}
    >
      <span
        style={{
          width: 34, height: 18, flex: "0 0 auto",
          background: on ? "var(--accent)" : "var(--line)",
          position: "relative", transition: "background 150ms",
        }}
      >
        <span
          style={{
            position: "absolute", top: 2, left: on ? 18 : 2,
            width: 14, height: 14, background: "#fff", transition: "left 150ms",
          }}
        />
      </span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

interface NestState {
  mode: "off" | "signin" | "capturing";
  available: boolean;
  signedOut: boolean;
  lastError: string | null;
  cameras: { id: string; label: string; frameAt: number | null; error: string | null }[];
}

/**
 * Google publishes no camera URL — the paid API returns a WebRTC session that
 * expires every five minutes, and home.google.com refuses to be framed. So a
 * browser window signed into the account keeps each camera open and the server
 * reads frames off it. Sign-in happens in that window: nothing here ever sees
 * the password.
 */
function NestBridge() {
  const [nest, setNest] = useState<NestState | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      setNest((await fetch("/api/nest", { cache: "no-store" }).then((r) => r.json())) as NestState);
    } catch {
      /* the panel just stays as it was */
    }
  }, []);

  useEffect(() => {
    void read();
    const t = setInterval(() => void read(), 5000);
    return () => clearInterval(t);
  }, [read]);

  const act = async (action: string) => {
    setBusy(true);
    try {
      const res = (await fetch("/api/nest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }).then((r) => r.json())) as { status?: NestState };
      if (res.status) setNest(res.status);
    } finally {
      setBusy(false);
    }
  };

  if (!nest) return null;

  const running = nest.mode === "capturing";

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="label label-accent">Google Nest</span>
        <span
          className="label"
          style={{ color: running ? "var(--ok, #22c55e)" : "var(--ink-faint)" }}
        >
          {running ? "capturing" : nest.mode === "signin" ? "signing in" : "off"}
        </span>
        <span className="flex-1" />
        <button
          className="label px-3 py-1 border"
          style={{ borderColor: "var(--line)" }}
          disabled={busy || !nest.available}
          onClick={() => void act("signin")}
        >
          1 · Open &amp; sign in
        </button>
        <button
          className="label px-3 py-1 border"
          style={{ borderColor: "var(--line)" }}
          disabled={busy || !nest.available || nest.cameras.length === 0}
          onClick={() => void act("start")}
        >
          2 · Start capture
        </button>
        <button
          className="label px-3 py-1 border"
          style={{ borderColor: "var(--line)" }}
          disabled={busy || !running}
          onClick={() => void act("stop")}
        >
          Stop
        </button>
      </div>

      <div className="label mt-2" style={{ color: "var(--ink-faint)", whiteSpace: "normal" }}>
        {!nest.available
          ? "No Chrome or Edge found on this machine."
          : "Open the window, sign in to Google, and open each camera full-screen — then copy that page’s address into a camera row above with the kind set to Google Nest. Start capture parks the window off-screen and reads a frame from it. Leave it running."}
      </div>

      {nest.signedOut && (
        <div className="label mt-1" style={{ color: "var(--warn)", whiteSpace: "normal" }}>
          Signed out — run step 1 again.
        </div>
      )}
      {nest.lastError && (
        <div className="label mt-1" style={{ color: "var(--dead)", whiteSpace: "normal" }}>
          {nest.lastError}
        </div>
      )}

      {nest.cameras.map((c) => (
        <div key={c.id} className="label mt-1" style={{ whiteSpace: "normal" }}>
          {c.label}:{" "}
          <span style={{ color: c.error ? "var(--dead)" : "var(--ink-dim)" }}>
            {c.error ?? (c.frameAt ? `frame ${Math.round((Date.now() - c.frameAt) / 1000)}s ago` : "waiting")}
          </span>
        </div>
      ))}
    </div>
  );
}
