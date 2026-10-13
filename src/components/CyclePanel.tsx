"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ago, eventWhen, routeChip, shortTime, until } from "@/lib/format";
import { useBox, useRotation } from "./hooks";
import { listColumns } from "@/lib/shape";
import { AutoScroll } from "./AutoScroll";
import { PrinterPanel } from "./PrinterPanel";
import { RadarPanel } from "./RadarPanel";
import { highlightPlaces } from "@/lib/places";
import type { FightCard, Item, Listing, LocalEvent, PanelId, TrafficEvent } from "@/lib/types";

interface Props {
  panels: PanelId[];
  dwellMs: number;
  /** Held on the current page by the window's lock. */
  locked?: boolean;
  now: number;
  tech: Item[];
  crime: Item[];
  traffic: { data: TrafficEvent[]; at: number };
  transit: Item[];
  /** Stations and streets to pick out of alert text. */
  transitPlaces: string[];
  fights: { data: FightCard[]; at: number };
  events: LocalEvent[];
  /** New local listings, newest first, and what each search is called. */
  market: Listing[];
  marketLabels: Record<string, string>;
  /** The printer page is skipped until a printer is set up. */
  printer: { configured: boolean; label: string };
}

const TITLES: Record<PanelId, string> = {
  fights: "Fight Cards",
  tech: "Tech",
  traffic: "Traffic",
  transit: "TTC Alerts",
  crime: "Local Crime",
  events: "Local Events",
  printer: "3D Printer",
  radar: "Radar",
  market: "Marketplace",
};

export function CyclePanel(props: Props) {
  const { panels, dwellMs, locked, now, fights } = props;

  // An event happening today pins the fight panel and stops rotation, which is
  // the whole point of the day-of treatment. `live` is checked as well as
  // `isToday` so a main event running past midnight keeps the panel rather
  // than losing it to the date rolling over mid-card.
  const todayCard = useMemo(
    () => fights.data.find((c) => c.isToday || c.live) ?? null,
    [fights.data],
  );
  const pinFights = Boolean(todayCard) && panels.includes("fights");

  const printerOn = props.printer.configured;
  const list = useMemo(
    () => (pinFights ? (["fights"] as PanelId[]) : panels.filter((p) => p !== "printer" || printerOn)),
    [pinFights, panels, printerOn],
  );
  /**
   * Held still while you are reading it.
   *
   * Moving the pointer over the panel pauses rotation; it resumes once the
   * pointer leaves or has sat still for ten seconds — so a cursor simply left
   * parked over the panel in kiosk mode does not freeze it forever.
   */
  const [reading, setReading] = useState(false);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteReading = () => {
    setReading(true);
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => setReading(false), 10_000);
  };
  const stopReading = () => {
    if (readTimer.current) clearTimeout(readTimer.current);
    setReading(false);
  };
  useEffect(() => () => {
    if (readTimer.current) clearTimeout(readTimer.current);
  }, []);

  const [index, setIndex] = useRotation(list.length, dwellMs, locked || pinFights || reading);

  // `[` and `]` step the pages; other parts of the screen can open one by name
  // (the printer chip in the top bar does). Both arrive as window events so
  // every carousel on screen responds.
  useEffect(() => {
    const onStep = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      setIndex((index + d + list.length) % list.length);
    };
    const onGoto = (e: Event) => {
      const i = list.indexOf((e as CustomEvent<PanelId>).detail);
      if (i >= 0) setIndex(i);
    };
    window.addEventListener("local24:carousel-step", onStep);
    window.addEventListener("local24:carousel-goto", onGoto);
    return () => {
      window.removeEventListener("local24:carousel-step", onStep);
      window.removeEventListener("local24:carousel-goto", onGoto);
    };
  }, [index, list, setIndex]);

  useEffect(() => {
    if (pinFights) setIndex(0);
  }, [pinFights, setIndex]);

  const current = list[index] ?? "tech";

  // How far down each page had scrolled when it rotated away, as a fraction
  // of its list. Coming back resumes there instead of at the top, so a long
  // list is read through across visits rather than its first rows forever.
  const scrolled = useRef(new Map<PanelId, number>());

  // A wide, short window flows its list into columns rather than leaving
  // most of every row empty.
  const [boxRef, box] = useBox<HTMLElement>();
  const cols = listColumns(box.w, box.h);

  return (
    <section
      ref={boxRef}
      className="panel flex flex-col"
      style={{ minHeight: 0 }}
      onPointerMove={noteReading}
      onPointerLeave={stopReading}
    >
      <div className="slab">
        <span className="label label-accent slab-name">{TITLES[current]}</span>
        {pinFights && <span className="label" style={{ color: "var(--accent)" }}>TODAY</span>}
        <span className="flex-1" />
        <div className="flex gap-1">
          {list.map((p, i) => (
            <button
              key={p}
              onClick={() => setIndex(i)}
              title={TITLES[p]}
              style={{
                width: i === index ? 14 : 7,
                height: 3,
                borderRadius: 2,
                background: i === index ? "var(--accent)" : "var(--line)",
                transition: "width 200ms ease, background 200ms ease",
              }}
            />
          ))}
        </div>
      </div>

      {/* The panel is short by design, so anything longer than it scrolls by
          itself rather than hiding the rest behind a scrollbar. */}
      <div key={current} className="flex-1 fade-in" style={{ minHeight: 0 }}>
        {/* A camera fills the page; it is not a list to scroll. */}
        {current === "printer" ? (
          <PrinterPanel label={props.printer.label} />
        ) : current === "radar" ? (
          <RadarPanel now={now} />
        ) : (
        <AutoScroll
          cycleMs={dwellMs}
          start={scrolled.current.get(current) ?? 0}
          onLeave={(f) => scrolled.current.set(current, f)}
        >
        {current === "fights" && <FightsPanel cards={props.fights.data} now={now} at={props.fights.at} />}
        {current === "tech" && <ItemsPanel items={props.tech} now={now} cols={cols} />}
        {current === "crime" && <ItemsPanel items={props.crime} now={now} cols={cols} />}
        {current === "traffic" && (
          <TrafficPanel events={props.traffic.data} at={props.traffic.at} now={now} cols={cols} />
        )}
        {current === "transit" && <TransitPanel items={props.transit} places={props.transitPlaces} cols={cols} />}
        {current === "events" && <EventsPanel events={props.events} now={now} cols={cols} />}
        {current === "market" && (
          <MarketPanel listings={props.market} labels={props.marketLabels} now={now} cols={cols} />
        )}
        </AutoScroll>
        )}
      </div>
    </section>
  );
}

function Empty({ what, at, now }: { what: string; at: number; now: number }) {
  return (
    <div className="grid place-items-center px-4 py-6 text-center">
      <div>
        <div className="label">{what}</div>
        <div className="label" style={{ color: "var(--ink-faint)", marginTop: 4 }}>
          {at ? `last update ${ago(at, now)}` : "waiting for first fetch"}
        </div>
      </div>
    </div>
  );
}

function FightsPanel({ cards, now, at }: { cards: FightCard[]; now: number; at: number }) {
  if (!cards.length) return <Empty what="No upcoming cards" at={at} now={now} />;
  const [lead, ...rest] = cards;

  return (
    <div className="flex flex-col">
      {/* Lead card: poster + countdown, expanded when it is today. */}
      <div className="row flex gap-3 p-3">
        {lead.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lead.posterUrl}
            alt=""
            style={{ width: 92, height: 62, objectFit: "cover", flex: "0 0 auto" }}
          />
        ) : (
          <div
            className="grid place-items-center label"
            style={{ width: 92, height: 62, background: "var(--panel-2)", flex: "0 0 auto" }}
          >
            {lead.promotion}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="flex items-center gap-2">
            <span
              className="tag px-1.5 py-0.5 shrink-0"
              style={{ background: "var(--accent)", color: "var(--accent-ink)", overflow: "visible" }}
            >
              {lead.promotion}
            </span>
            <span className="label num" style={{ color: lead.isToday ? "var(--accent)" : "var(--ink-dim)" }}>
              {until(lead.startsAt, now)}
            </span>
            {lead.source === "manual" && <span className="label" title="Hand-entered override">MANUAL</span>}
          </div>
          <div className="font-bold text-sm mt-1 wrap2">{lead.name}</div>
          <div className="label wrap2" style={{ marginTop: 2 }}>
            {lead.startsAt ? shortTime(lead.startsAt) : "TBA"} · {lead.location || "—"}
          </div>
        </div>
      </div>

      {/* Bout order, fetched only for a card happening today. */}
      {lead.fights.length > 0 && (
        <div className="row flex flex-col">
          {lead.fights.slice(0, 6).map((f, i) => (
            <div
              key={`${f.redName}-${f.blueName}-${i}`}
              className="flex items-center gap-2 px-3 py-1.5"
              style={{ borderTop: i ? "1px solid var(--rule)" : undefined }}
            >
              {f.isMain && <span className="label label-accent">MAIN</span>}
              <span className="text-xs wrap2 flex-1">{f.bout}</span>
              <span className="label wrap2 shrink-0" style={{ maxWidth: "16ch", textAlign: "right" }}>{f.weightClass}</span>
            </div>
          ))}
        </div>
      )}

      {rest.slice(0, 6).map((c) => (
        <div
          key={c.id}
          className="row flex items-center gap-2 px-3 py-2"
        >
          <span className="label" style={{ width: "4ch" }}>{c.promotion}</span>
          <span className="text-xs wrap2 flex-1">{c.name}</span>
          <span className="label num">{until(c.startsAt, now)}</span>
        </div>
      ))}
    </div>
  );
}

/** A list that flows into `cols` columns; one column is a plain stack. */
function List({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div className="cp-list" data-cols={cols} style={{ "--cols": cols } as React.CSSProperties}>
      {children}
    </div>
  );
}

/**
 * What's on nearby this week: when, what, where and how far. Free events are
 * marked, since that is usually the deciding question.
 */
function EventsPanel({ events, now, cols }: { events: LocalEvent[]; now: number; cols: number }) {
  if (!events.length) return <Empty what="No events found nearby this week" at={0} now={now} />;
  return (
    <List cols={cols}>
      {events.map((e) => {
        const when = e.ongoing ? { day: "DAILY", time: eventWhen(e.dates[0], now).time } : eventWhen(e.dates[0], now);
        const soon = !e.ongoing && (when.day === "NOW" || when.day === "TODAY");
        return (
          <a
            key={e.id}
            href={e.link || undefined}
            target="_blank"
            rel="noreferrer"
            className="row row-link flex items-start gap-2 px-3 py-1.5"
          >
            <span
              className="tag px-1.5 py-0.5 shrink-0 text-center"
              style={{
                background: soon ? "var(--accent)" : "var(--panel-2)",
                color: soon ? "var(--accent-ink)" : "var(--ink-dim)",
                // Sized by its words, not a fixed width: "TODAY" and "TMRW"
                // were cut to "TO…" once the type was scaled up.
                minWidth: "6.5ch",
                overflow: "visible",
                lineHeight: 1.15,
              }}
            >
              {when.day}
              <br />
              <span style={{ opacity: 0.8 }}>{when.time}</span>
            </span>
            <span className="flex flex-col gap-0.5" style={{ minWidth: 0 }}>
              <span className="text-xs font-semibold leading-snug">{e.name}</span>
              <span className="flex items-center gap-2 label" style={{ minWidth: 0 }}>
                <span className="wrap2" style={{ color: "var(--ink-dim)" }}>{e.venue}</span>
                {e.distanceKm !== null && <span className="shrink-0">{e.distanceKm} km</span>}
                {e.free && <span className="shrink-0" style={{ color: "var(--ok)" }}>FREE</span>}
              </span>
            </span>
          </a>
        );
      })}
    </List>
  );
}

const SOURCE_TAG: Record<Listing["source"], { text: string; color: string }> = {
  facebook: { text: "FB", color: "#4c8dff" },
  kijiji: { text: "KIJIJI", color: "#a78bfa" },
  karrot: { text: "KARROT", color: "#ff7a2f" },
};

/**
 * New local listings for the things being watched for, newest first. A
 * listing from the last two hours is marked NEW; clicking one opens it in the
 * reader like any other link.
 */
function MarketPanel({
  listings, labels, now, cols,
}: {
  listings: Listing[];
  labels: Record<string, string>;
  now: number;
  cols: number;
}) {
  if (!listings.length) return <Empty what="No listings yet" at={0} now={now} />;
  return (
    <List cols={cols}>
      {listings.slice(0, 40).map((l) => {
        const at = l.postedAt ?? l.firstSeen;
        const fresh = now - at < 2 * 60 * 60 * 1000;
        const tag = SOURCE_TAG[l.source];
        return (
          <a
            key={l.id}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="row row-link flex items-center gap-2 px-3 py-1.5"
          >
            {l.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={l.image}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 2, flex: "0 0 auto", background: "var(--panel-2)" }}
              />
            ) : (
              <span style={{ width: 44, height: 44, borderRadius: 2, flex: "0 0 auto", background: "var(--panel-2)" }} />
            )}
            <span className="flex flex-col gap-0.5" style={{ minWidth: 0, flex: 1 }}>
              <span className="text-xs font-semibold leading-snug wrap2">{l.title}</span>
              <span className="flex items-center gap-2" style={{ minWidth: 0 }}>
                <span className="figure font-bold text-xs shrink-0" style={{ color: l.price === "Free" ? "var(--ok)" : "var(--ink)" }}>
                  {l.price || "—"}
                </span>
                <span className="tag shrink-0" style={{ color: tag.color }}>{tag.text}</span>
                <span className="label wrap2" style={{ color: "var(--ink-dim)" }}>{l.place}</span>
              </span>
            </span>
            <span className="flex flex-col items-end gap-0.5 shrink-0">
              {fresh ? (
                <span className="tag" style={{ color: "var(--accent)" }}>NEW</span>
              ) : (
                <span className="label num" style={{ color: "var(--ink-faint)" }}>{ago(at, now)}</span>
              )}
              <span className="label" style={{ color: "var(--ink-faint)" }}>{labels[l.search] ?? ""}</span>
            </span>
          </a>
        );
      })}
    </List>
  );
}

function ItemsPanel({ items, now, cols }: { items: Item[]; now: number; cols: number }) {
  if (!items.length) return <Empty what="No headlines yet" at={0} now={now} />;
  return (
    <List cols={cols}>
      {items.slice(0, 14).map((it) => (
        <a
          key={it.id}
          href={it.link || undefined}
          target="_blank"
          rel="noreferrer"
          className="row row-link flex flex-col gap-0.5 px-3 py-2"
        >
          <span className="text-xs font-semibold leading-snug">{it.title}</span>
          {it.body && (
            // The gist, in two lines at most. A headline on its own says what
            // happened to someone who already knows the story.
            <span className="news-summary">{it.body}</span>
          )}
          <span className="flex items-center gap-2">
            <span className="tag" style={{ color: "var(--ink-dim)" }}>
              {String(it.meta?.source ?? it.sourceId)}
            </span>
            <span className="label" style={{ color: "var(--ink-faint)" }}>{ago(it.published, now)}</span>
          </span>
        </a>
      ))}
    </List>
  );
}

function TrafficPanel({ events, at, now, cols }: { events: TrafficEvent[]; at: number; now: number; cols: number }) {
  if (!events.length) return <Empty what="Roads clear" at={at} now={now} />;
  return (
    <List cols={cols}>
      {events.slice(0, 14).map((e) => (
        <div
          key={e.id}
          className="row flex gap-2 px-3 py-2"
        >
          <span
            style={{
              width: 3, flex: "0 0 auto",
              background: e.isFullClosure ? "var(--accent)" : "var(--warn)",
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div className="flex items-center gap-2">
              <span className="label" style={{ color: "var(--ink)" }}>{e.roadway}</span>
              <span className="label">{e.direction}</span>
              {e.isFullClosure && (
                <span className="label" style={{ color: "var(--accent)" }}>CLOSED</span>
              )}
            </div>
            <div className="text-xs leading-snug" style={{ color: "var(--ink-dim)" }}>
              {e.description}
            </div>
          </div>
        </div>
      ))}
    </List>
  );
}

function TransitPanel({ items, places, cols }: { items: Item[]; places: string[]; cols: number }) {
  if (!items.length) {
    return (
      <div className="grid place-items-center px-4 py-6 text-center">
        <div>
          <div className="label">No TTC alerts</div>
          <div className="label" style={{ color: "var(--ink-faint)", marginTop: 4 }}>
            Everything running normally
          </div>
        </div>
      </div>
    );
  }
  return (
    <List cols={cols}>
      {items.slice(0, 16).map((it) => {
        const route = String(it.meta?.route ?? "");
        const mode = String(it.meta?.mode ?? "");
        const planned = it.meta?.planned === true;
        return (
          <a
            key={it.id}
            href={it.link || undefined}
            target="_blank"
            rel="noreferrer"
            className="row row-link flex items-start gap-2 px-3 py-1.5"
          >
            <span
              className="tag px-1.5 py-0.5 shrink-0"
              style={{
                // Unplanned disruptions are the ones that change your morning.
                background: planned ? "var(--panel-2)" : "var(--accent)",
                color: planned ? "var(--ink-dim)" : "var(--accent-ink)",
                minWidth: "4.5ch",
                maxWidth: "9ch",
                textAlign: "center",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={`${mode}${planned ? " · planned" : " · unplanned"}${route ? ` · ${route}` : ""}`}
            >
              {/*
                A station alert lists every route that touches the station —
                "5,25,34,54,72,100,162,…" is wider than the sentence it labels
                and says nothing. Past a couple of routes the mode is the
                useful label; the full list stays in the tooltip.
              */}
              {routeChip(route, mode)}
            </span>
            {it.meta?.local === true && (
              <span
                className="label shrink-0"
                style={{ color: "var(--warn)" }}
                title="Names somewhere you travel through"
              >
                ●
              </span>
            )}
            <span className="text-xs leading-snug flex-1">
              {/* Stations and streets you travel through are picked out of the
                  sentence, because that is what decides if this matters. */}
              {highlightPlaces(it.title, places).map((part, i) =>
                part.hit ? (
                  <mark
                    key={i}
                    style={{
                      background: "transparent",
                      color: "var(--warn)",
                      fontWeight: 800,
                    }}
                  >
                    {part.text}
                  </mark>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </span>
          </a>
        );
      })}
    </List>
  );
}
