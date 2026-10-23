"use client";

import { ago } from "@/lib/format";
import { EVERGREEN, requestPlace, upcomingOccasions } from "@/lib/business";
import type { AppState } from "@/lib/state";
import type { Item, Listing } from "@/lib/types";

/**
 * The print shop's pages: what to make, what is selling, and who is asking.
 * Every idea links to a search for models, so a thought becomes a printable
 * file in one click (the reader opens Printables results in place).
 */

const printablesSearch = (q: string) => `https://www.printables.com/search/models?q=${encodeURIComponent(q)}`;

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="biz-section">
      <div className="biz-head">
        <span className="label label-accent">{title}</span>
        {note && <span className="label" style={{ color: "var(--ink-faint)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="label px-3 py-4" style={{ color: "var(--ink-faint)", whiteSpace: "normal" }}>{text}</div>;
}

/** The catalogue: the calendar, this week's trending models, Canada's searches, and staples. */
export function IdeasPanel({ ideas, now }: { ideas: AppState["ideas"]; now: number }) {
  const coming = upcomingOccasions(now, 75).slice(0, 2);
  // Models you can sell first, then by how much makers like them this week.
  const models = [...(ideas?.models ?? [])].sort((a, b) => Number(b.sellable) - Number(a.sellable) || b.likes - a.likes).slice(0, 12);
  const trends = (ideas?.trends ?? []).slice(0, 10);

  return (
    <div className="biz">
      <Section title="Coming up" note="list ahead: people order early">
        {coming.length ? coming.map((o) => (
          <div key={o.name + o.date} className="row px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold">{o.name}</span>
              <span className="label">{o.daysAway === 0 ? "today" : `in ${o.daysAway} days`}</span>
              <span className="flex-1" />
              <span className="tag" style={{ color: o.listInDays <= 0 ? "var(--accent)" : "var(--warn)" }}>
                {o.listInDays <= 0 ? "LIST NOW" : `LIST IN ${o.listInDays}D`}
              </span>
            </div>
            <div className="biz-chips">
              {o.ideas.map((idea) => (
                <a key={idea} href={printablesSearch(idea)} target="_blank" rel="noreferrer" className="biz-chip">{idea}</a>
              ))}
            </div>
          </div>
        )) : <Empty text="Nothing big on the calendar in the next ten weeks." />}
      </Section>

      <Section title="Trending this week" note="Printables, by likes in 7 days">
        {models.length ? (
          <div className="biz-grid">
            {models.map((m) => (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="biz-card row-link" title={`${m.name} · ${m.license || "no licence listed"}`}>
                {m.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="biz-thumb" />
                ) : <span className="biz-thumb" />}
                <span className="biz-card-name wrap2">{m.name}</span>
                <span className="flex items-center gap-2" style={{ minWidth: 0 }}>
                  <span className="label num">♥ {m.likes.toLocaleString()}</span>
                  <span className="tag" style={{ color: m.sellable ? "var(--ok)" : "var(--ink-faint)" }}>
                    {m.sellable ? "OK TO SELL" : "PERSONAL USE"}
                  </span>
                </span>
              </a>
            ))}
          </div>
        ) : <Empty text="Loading this week's trending models…" />}
      </Section>

      <Section title="Trending in Canada today" note="a print people want this week?">
        {trends.length ? (
          <div className="biz-chips px-3 pb-2">
            {trends.map((t) => (
              <a key={t.query} href={printablesSearch(t.query)} target="_blank" rel="noreferrer" className="biz-chip" title={t.context || t.query}>
                {t.query}{t.traffic ? <span className="biz-chip-n"> {t.traffic}</span> : null}
              </a>
            ))}
          </div>
        ) : <Empty text="Loading today's searches…" />}
      </Section>

      <Section title="Always sells" note="staples for a print-and-paint shop">
        {EVERGREEN.map((e) => (
          <a key={e.title} href={printablesSearch(e.search)} target="_blank" rel="noreferrer" className="row row-link flex flex-col px-3 py-1.5">
            <span className="text-xs font-semibold">{e.title}</span>
            <span className="label wrap2" style={{ color: "var(--ink-dim)" }}>{e.why}</span>
          </a>
        ))}
      </Section>
    </div>
  );
}

/** What 3D-printed things are selling on eBay, best seller first. */
export function SellersPanel({ sellers, cols }: { sellers: AppState["sellers"]; cols: number }) {
  const items = sellers?.items ?? [];
  if (!items.length) return <Empty text="Reading eBay… the first results arrive within a few minutes." />;
  return (
    <div>
      {!sellers.tracking && (
        <div className="label px-3 py-1.5" style={{ color: "var(--warn)", whiteSpace: "normal" }}>
          Ranked by total sold for now. Sales in the last day show from tomorrow, once there is a day of readings to compare.
        </div>
      )}
      <div className="cp-list" data-cols={cols} style={{ "--cols": cols } as React.CSSProperties}>
        {items.slice(0, 30).map((s) => (
          <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="row row-link flex items-center gap-2 px-3 py-1.5">
            {s.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 2, flex: "0 0 auto", background: "var(--panel-2)" }} />
            ) : <span style={{ width: 44, height: 44, flex: "0 0 auto", background: "var(--panel-2)", borderRadius: 2 }} />}
            <span className="flex flex-col gap-0.5" style={{ minWidth: 0, flex: 1 }}>
              <span className="text-xs font-semibold leading-snug wrap2">{s.title}</span>
              <span className="label truncate" style={{ color: "var(--ink-dim)" }}>{s.price} · {s.query}</span>
            </span>
            <span className="flex flex-col items-end shrink-0">
              {s.soldToday !== null ? (
                <span className="figure font-bold" style={{ color: s.soldToday > 0 ? "var(--accent)" : "var(--ink-faint)" }}>
                  +{s.soldToday}
                </span>
              ) : null}
              <span className="label num" style={{ color: "var(--ink-faint)" }}>
                {s.soldToday !== null ? "today" : `${s.sold.toLocaleString()} sold`}
              </span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

const PLACE_TAG: Record<string, { text: string; color: string }> = {
  toronto: { text: "TORONTO", color: "var(--accent)" },
  ontario: { text: "ONTARIO", color: "var(--warn)" },
  canada: { text: "CANADA", color: "var(--cool)" },
  elsewhere: { text: "", color: "var(--ink-faint)" },
};

/**
 * People asking for something to be printed: nearby marketplace posts and
 * Reddit requests. Anything local comes first: those are customers.
 */
export function LeadsPanel({ leads, listings, now, cols }: { leads: Item[]; listings: Listing[]; now: number; cols: number }) {
  const rank = { toronto: 0, ontario: 1, canada: 2, elsewhere: 3 } as const;
  const rows = [
    ...listings.filter((l) => l.search === "leads").map((l) => ({
      key: l.id, title: l.title, url: l.url, at: l.postedAt ?? l.firstSeen,
      // Marketplace searches are already limited to the Toronto area.
      place: "toronto" as const, source: l.source === "facebook" ? "FB" : l.source.toUpperCase(),
    })),
    ...leads.map((it) => ({
      key: it.id, title: it.title, url: it.link, at: it.published,
      place: (String(it.meta?.place ?? requestPlace(it.title)) as keyof typeof rank), source: "REDDIT",
    })),
  ].sort((a, b) => (rank[a.place] ?? 3) - (rank[b.place] ?? 3) || b.at - a.at);

  if (!rows.length) return <Empty text="No print requests right now." />;
  return (
    <div className="cp-list" data-cols={cols} style={{ "--cols": cols } as React.CSSProperties}>
      {rows.slice(0, 25).map((r) => {
        const tag = PLACE_TAG[r.place] ?? PLACE_TAG.elsewhere;
        return (
          <a key={r.key} href={r.url} target="_blank" rel="noreferrer" className="row row-link flex items-start gap-2 px-3 py-1.5">
            <span className="flex flex-col gap-0.5" style={{ minWidth: 0, flex: 1 }}>
              <span className="text-xs font-semibold leading-snug wrap2">{r.title}</span>
              <span className="flex items-center gap-2">
                {tag.text && <span className="tag" style={{ color: tag.color }}>{tag.text}</span>}
                <span className="tag" style={{ color: "var(--ink-dim)" }}>{r.source}</span>
                <span className="label" style={{ color: "var(--ink-faint)" }}>{ago(r.at, now)}</span>
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}
