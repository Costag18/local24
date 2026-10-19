import type { AppState } from "./state";
import type { BoardRow } from "./board";
import type { PrinterView } from "./printer";
import {
  ago, aqiLabel, compactTime, duration, eventWhen, fxLine, holidayLine, longDate, nextWetDay,
  pickupDay, rainStartsInMinutes, shortDestination, shortStop, shortTime, temp, until,
} from "./format";
import { routeColor } from "./routeColors";
import { radarGrid } from "./radar";

/**
 * LOCAL 24 for old browsers — a PlayStation 3, an old smart TV.
 *
 * The dashboard proper is a React app; a PS3's 2006-era browser cannot run
 * it, and cannot reach HTTPS sites either. This is the same information as
 * plain HTML built on the server: tables instead of flexbox, hex colours
 * instead of variables, no JavaScript at all, and every picture served from
 * the dashboard itself over http. Pages rotate the way CP24's do, by each one
 * refreshing itself into the next after a few seconds.
 */

export interface TvData {
  state: AppState;
  board: BoardRow[];
  printer: PrinterView | null;
  /** Newest radar frame time, when the radar page is the one being drawn. */
  radarFrame: string | null;
  now: number;
}

export type TvPage = "now" | "headlines" | "market" | "roads" | "radar" | "fights" | "printer";

const TITLES: Record<TvPage, string> = {
  now: "Weather & buses",
  headlines: "Headlines",
  market: "Marketplace",
  roads: "Roads & TTC",
  radar: "Radar",
  fights: "Fight cards",
  printer: "3D printer",
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const e = escapeHtml;

/** Cut at a word boundary so a long headline still fits one screen. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 15)).trimEnd() + "…";
}

function printing(p: PrinterView | null): boolean {
  const st = p?.status?.state;
  return st === "RUNNING" || st === "PAUSE" || st === "PREPARE";
}

/** The pages worth showing right now, in order. Empty ones are skipped. */
export function tvPages(d: Pick<TvData, "state" | "printer">): TvPage[] {
  const pages: TvPage[] = ["now", "headlines"];
  if (d.state.market?.length) pages.push("market");
  pages.push("roads", "radar");
  if (d.state.fights.data.length) pages.push("fights");
  if (printing(d.printer)) pages.push("printer");
  return pages;
}

// --- pieces -----------------------------------------------------------------

function header(d: TvData): string {
  const w = d.state.weather?.data;
  return `<table class="top" width="100%" cellspacing="0" cellpadding="0"><tr>
<td class="brand">LOCAL<span class="b24">24</span></td>
<td class="clock">${e(shortTime(d.now))}<div class="date">${e(longDate(d.now))}</div></td>
<td class="now">${w ? `<span class="nowtemp">${e(temp(w.tempC))}</span> ${e(w.condition || "")}` : ""}</td>
</tr></table>`;
}

/** One line of the small facts: bins, a coming holiday, the dollar, the print. */
function facts(d: TvData): string {
  const out: string[] = [];
  const bins = d.state.pickup?.next[0];
  if (bins) out.push(`<b>Bins ${e(pickupDay(bins.date, d.now))}:</b> ${e(bins.items.join(", "))}`);
  const h = d.state.holidays?.[0];
  const hl = h ? holidayLine(h, d.now, 14) : null;
  if (hl) out.push(`<b>Holiday:</b> ${e(hl)}`);
  if (d.state.fx) out.push(`<b>USD/CAD</b> ${e(fxLine(d.state.fx).replace("US$1 = ", ""))}`);
  const s = d.printer?.status;
  if (s && printing(d.printer)) {
    const left = s.remainingMin ?? 0;
    out.push(`<b>Printer:</b> ${s.percent ?? 0}%${left > 0 ? `, done ${e(shortTime(d.now + left * 60_000))}` : ""}`);
  }
  return out.length ? `<div class="facts">${out.join('<span class="sep"> &nbsp;|&nbsp; </span>')}</div>` : "";
}

function footer(pages: TvPage[], page: TvPage, secs: number): string {
  const dots = pages
    .map((p) => (p === page ? `<span class="on">${e(TITLES[p])}</span>` : `<span class="off">${e(TITLES[p])}</span>`))
    .join(" &nbsp; ");
  return `<div class="foot">${dots}<span class="every"> &nbsp; &middot; next page in ${secs}s</span></div>`;
}

function pageNow(d: TvData): string {
  const w = d.state.weather?.data;
  let weather = '<div class="dim">Weather is still loading.</div>';
  if (w) {
    const rain = rainStartsInMinutes(w.nowcast, d.now);
    const wet = nextWetDay(w.daily);
    const aq = aqiLabel(w.aqi);
    const rainText = rain !== null ? (rain === 0 ? "Raining now" : `Rain in ${rain} min`) : wet ? `${wet.day} ${wet.chance}%` : "Dry";
    const days = w.daily.slice(0, 4)
      .map((x) => `<td class="day"><div class="dname">${e(x.day.slice(0, 3).toUpperCase())}</div><div class="hi">${e(temp(x.hiC))}</div><div class="lo">${e(temp(x.loC))}</div></td>`)
      .join("");
    const hours = w.hourly.slice(0, 6)
      .map((h) => `<td class="hour"><div class="htime">${e(compactTime(h.at))}</div><div class="htemp">${e(temp(h.tempC))}</div></td>`)
      .join("");
    weather = `<table width="100%" cellspacing="0" cellpadding="0"><tr>
<td valign="middle"><div class="bigtemp">${e(temp(w.tempC))}</div><div class="cond">${e(w.condition || "")}</div>
<div class="dim">${w.feelsLikeC !== null && w.feelsLikeC !== w.tempC ? `Feels ${e(temp(w.feelsLikeC))} &middot; ` : ""}${e(w.windDir ?? "")} ${w.windKph ?? "--"} km/h</div></td>
${days}</tr></table>
<table class="stats" width="100%" cellspacing="0" cellpadding="0"><tr>
<td><div class="cap">RAIN</div><div class="val">${e(rainText)}</div></td>
<td><div class="cap">AIR</div><div class="val ${aq.tone}">${e(aq.text)}</div></td>
<td><div class="cap">SUN</div><div class="val">${w.sunrise ? e(compactTime(w.sunrise)) : "--"} / ${w.sunset ? e(compactTime(w.sunset)) : "--"}</div></td>
</tr></table>
<table class="hours" width="100%" cellspacing="0" cellpadding="0"><tr>${hours}</tr></table>
${w.warnings[0] ? `<div class="alert">${e(w.warnings[0].title)}</div>` : ""}`;
  }

  const routes = d.state.config.map.routes;
  const order = (r: string) => (routes.indexOf(r) < 0 ? 99 : routes.indexOf(r));
  const rows = [...d.board]
    .sort((a, b) => order(a.route) - order(b.route) || a.heading.localeCompare(b.heading))
    .map((r) => {
      const next = r.times.filter((t) => t.at > d.now - 30_000).slice(0, 3);
      const times = next.length
        ? next.map((t, i) => {
            const m = Math.max(0, Math.round((t.at - d.now) / 60_000));
            const label = `${t.scheduled ? "~" : ""}${m === 0 ? "Now" : m}`;
            return i === 0 ? `<span class="first">${e(label)}${m > 0 ? '<span class="unit"> min</span>' : ""}</span>` : `<span class="later">${e(label)}</span>`;
          }).join(" ")
        : '<span class="dim">no service</span>';
      return `<tr><td class="chip" style="background:${routeColor(r.route, order(r.route))}">${e(r.route)}</td>
<td class="where"><div class="dir">${e(r.heading)}${r.towards ? ` &rarr; ${e(shortDestination(r.towards))}` : ""}</div><div class="stop">${e(shortStop(r.stopTitle))}</div></td>
<td class="times">${times}</td></tr>`;
    })
    .join("");
  const buses = rows
    ? `<div class="head">Next buses</div><table class="board" width="100%" cellspacing="0" cellpadding="0">${rows}</table>`
    : '<div class="head">Next buses</div><div class="dim">No stops yet.</div>';

  return `<table width="100%" cellspacing="0" cellpadding="0"><tr>
<td width="50%" valign="top" class="col">${weather}</td>
<td width="3%"></td>
<td valign="top" class="col">${buses}</td></tr></table>`;
}

function pageHeadlines(d: TvData): string {
  const items = [...d.state.tech.slice(0, 5), ...d.state.local.slice(0, 5)]
    .sort((a, b) => b.published - a.published)
    .slice(0, 6);
  if (!items.length) return '<div class="dim">No headlines yet.</div>';
  return items
    .map((it) => `<div class="story"><div class="title">${e(clip(it.title, 120))}</div><div class="meta">${e(String(it.meta?.source ?? it.sourceId))} &middot; ${e(ago(it.published, d.now))}</div></div>`)
    .join("");
}

function pageRoads(d: TvData): string {
  const roads = d.state.traffic.data.slice(0, 4)
    .map((t) => `<div class="story"><div class="title"><span class="${t.isFullClosure ? "bad" : "warn"}">${t.isFullClosure ? "CLOSED" : "ROADWORK"}</span> ${e(t.roadway)} ${e(t.direction)}</div><div class="meta">${e(clip(t.description, 100))}</div></div>`)
    .join("") || '<div class="dim">Roads clear.</div>';
  const ttc = d.state.transit.slice(0, 4)
    .map((t) => `<div class="story"><div class="title">${e(clip(t.title, 120))}</div></div>`)
    .join("") || '<div class="dim">No TTC alerts.</div>';
  return `<table width="100%" cellspacing="0" cellpadding="0"><tr>
<td width="50%" valign="top" class="col"><div class="head">Roads</div>${roads}</td><td width="3%"></td>
<td valign="top" class="col"><div class="head">TTC alerts</div>${ttc}</td></tr></table>`;
}

function pageMarket(d: TvData): string {
  const tag: Record<string, string> = { facebook: "FB", kijiji: "KIJIJI", karrot: "KARROT" };
  const rows = d.state.market.slice(0, 8)
    .map((l) => `<tr><td class="price">${e(l.price || "--")}</td><td class="where"><div class="dir">${e(l.title)}</div><div class="stop">${tag[l.source] ?? ""} &middot; ${e(l.place)} &middot; ${e(ago(l.postedAt ?? l.firstSeen, d.now))}</div></td></tr>`)
    .join("");
  return `<table class="board" width="100%" cellspacing="0" cellpadding="0">${rows}</table>`;
}

function pageRadar(d: TvData): string {
  if (!d.radarFrame) return '<div class="dim">Radar unavailable right now.</div>';
  const home = d.state.config.home;
  const g = radarGrid(home.lat, home.lon);
  const tile = 158;
  const k = tile / 256;
  const width = g.cols * tile;
  const height = g.rows * tile;
  const cells: string[] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      cells.push(`<img src="/api/radar/tile/${g.z}/${g.x0 + c}/${g.y0 + r}" width="${tile}" height="${tile}" style="position:absolute;left:${c * tile}px;top:${r * tile}px">`);
    }
  }
  const overlay = ["RADAR_1KM_RRAI", "RADAR_1KM_RSNO"]
    .map((layer) => `<img src="/api/radar/frame?layer=${layer}&amp;time=${encodeURIComponent(d.radarFrame as string)}" width="${width}" height="${height}" style="position:absolute;left:0;top:0">`)
    .join("");
  const labels: string[] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      labels.push(`<img src="/api/radar/tile/${g.z}/${g.x0 + c}/${g.y0 + r}?layer=ref" width="${tile}" height="${tile}" style="position:absolute;left:${c * tile}px;top:${r * tile}px">`);
    }
  }
  const [hx, hy] = g.px(home.lat, home.lon);
  const marker = `<div style="position:absolute;left:${Math.round(hx * k) - 6}px;top:${Math.round(hy * k) - 6}px;width:8px;height:8px;border:2px solid #ffffff;background:#e8192c"></div>`;
  return `<table width="100%" cellspacing="0" cellpadding="0"><tr>
<td width="${width}" valign="top"><div style="position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#0b0d10">${cells.join("")}${overlay}${labels.join("")}${marker}</div></td>
<td width="3%"></td>
<td valign="top" class="col"><div class="head">Radar</div><div class="cond">${e(shortTime(Date.parse(d.radarFrame)))}</div>
<div class="dim">Rain and snow over southern Ontario, newest frame from Environment Canada. The red square is home.</div></td>
</tr></table>`;
}

function pageFights(d: TvData): string {
  const [lead, ...rest] = d.state.fights.data;
  if (!lead) return '<div class="dim">No upcoming cards.</div>';
  const bouts = lead.fights.slice(0, 6)
    .map((f) => `<tr><td class="where"><div class="dir">${f.isMain ? '<span class="bad">MAIN</span> ' : ""}${e(f.bout)}</div></td><td class="stop" align="right">${e(f.weightClass.replace(/\s+bout$/i, ""))}</td></tr>`)
    .join("");
  const others = rest.slice(0, 4)
    .map((c) => `<div class="meta">${e(c.promotion)} &middot; ${e(c.name)} &middot; ${e(until(c.startsAt, d.now))}</div>`)
    .join("");
  const when = lead.startsAt ? eventWhen(lead.startsAt, d.now) : null;
  return `<div class="title"><span class="bad">${e(lead.promotion)}</span> ${e(lead.name)}</div>
<div class="meta">${when ? `${e(when.day)} ${e(when.time)} &middot; ` : ""}${e(lead.location || "")} &middot; ${e(until(lead.startsAt, d.now))}</div>
${bouts ? `<table class="board" width="100%" cellspacing="0" cellpadding="0">${bouts}</table>` : ""}
${others ? `<div class="head" style="margin-top:14px">Coming up</div>${others}` : ""}`;
}

function pagePrinter(d: TvData): string {
  const s = d.printer?.status;
  if (!s) return '<div class="dim">Printer offline.</div>';
  const pct = s.percent ?? 0;
  const left = s.remainingMin ?? 0;
  const trays = s.trays
    .map((t) => `<td class="tray"><span style="background:${t.type ? t.color : "#333333"}">&nbsp;&nbsp;&nbsp;</span> ${e(t.type || "empty")}${t.remain !== null ? ` ${t.remain}%` : ""}${t.active ? " &larr;" : ""}</td>`)
    .join("");
  return `<div class="title">${e(s.file || "Printing")}</div>
<table width="100%" cellspacing="0" cellpadding="0" class="bar"><tr><td width="${Math.max(1, pct)}%" class="barfill">&nbsp;</td><td class="barrest">&nbsp;</td></tr></table>
<div class="cond">${pct}%${left > 0 ? ` &middot; done ${e(shortTime(d.now + left * 60_000))} (${e(duration(left))} left)` : ""}</div>
<div class="meta">${s.layer !== null && s.totalLayers ? `Layer ${s.layer}/${s.totalLayers} &middot; ` : ""}Nozzle ${s.nozzle !== null ? Math.round(s.nozzle) : "--"}&deg; &middot; Bed ${s.bed !== null ? Math.round(s.bed) : "--"}&deg;</div>
${trays ? `<table class="trays" cellspacing="0" cellpadding="0"><tr>${trays}</tr></table>` : ""}`;
}

const CSS = `
body{margin:0;padding:16px 36px;background:#04060c;color:#eef2f8;font-family:Arial,Helvetica,sans-serif;font-size:26px}
.top td{vertical-align:middle}
.brand{background:#e8192c;color:#ffffff;font-weight:bold;font-size:40px;padding:6px 18px;width:1%;white-space:nowrap}
.b24{color:#ffd0d4}
.clock{font-size:42px;font-weight:bold;padding-left:24px;white-space:nowrap}
.date{font-size:18px;color:#8d9bb4;font-weight:normal}
.now{text-align:right;font-size:26px;color:#c9d2e3}
.nowtemp{font-size:42px;font-weight:bold;color:#ffffff}
.facts{margin-top:10px;padding:8px 12px;background:#0b1019;border:1px solid #1c2437;font-size:22px;color:#c9d2e3}
.sep{color:#55627c}
.pagetitle{margin:12px 0 6px;font-size:22px;font-weight:bold;color:#e8192c;letter-spacing:2px}
.col{padding:0}
.head{font-size:20px;font-weight:bold;color:#e8192c;letter-spacing:2px;margin-bottom:6px}
.bigtemp{font-size:96px;font-weight:bold;line-height:96px}
.cond{font-size:32px;font-weight:bold}
.dim{color:#8d9bb4;font-size:22px}
.day{text-align:center;border-left:1px solid #1c2437;padding:0 6px}
.dname{font-size:18px;color:#8d9bb4}.hi{font-size:34px;font-weight:bold}.lo{font-size:24px;color:#8d9bb4}
.stats{margin-top:12px;border-top:1px solid #1c2437}
.stats td{text-align:center;padding-top:8px}
.cap{font-size:16px;color:#8d9bb4;letter-spacing:2px}.val{font-size:30px;font-weight:bold}
.ok{color:#2fbe6a}.warn{color:#f5a524}.bad{color:#e8192c}
.hours{margin-top:12px;border-top:1px solid #1c2437}
.hour{text-align:center;padding-top:8px}.htime{font-size:16px;color:#8d9bb4}.htemp{font-size:28px;font-weight:bold}
.alert{margin-top:12px;background:#e8192c;color:#ffffff;font-weight:bold;padding:8px 12px;font-size:24px}
.board td{border-bottom:1px solid #151c2b;padding:4px 6px;vertical-align:middle}
.chip{color:#04070d;font-weight:bold;font-size:26px;text-align:center;width:64px}
.where{padding-left:12px}
.dir{font-size:22px;font-weight:bold}.stop{font-size:17px;color:#8d9bb4}
.times{text-align:right;white-space:nowrap}
.first{font-size:32px;font-weight:bold}.unit{font-size:16px;color:#8d9bb4}.later{font-size:24px;color:#8d9bb4}
.story{padding:6px 0;border-bottom:1px solid #151c2b}
.title{font-size:28px;font-weight:bold;line-height:33px}
.meta{font-size:20px;color:#8d9bb4;margin-top:2px}
.price{font-size:30px;font-weight:bold;width:150px;white-space:nowrap}
.bar{margin:14px 0 8px;height:22px}.barfill{background:#e8192c}.barrest{background:#1c2437}
.trays{margin-top:12px}.tray{padding-right:24px;font-size:22px}
.foot{margin-top:12px;font-size:18px;color:#55627c}
.foot .on{color:#ffffff;font-weight:bold;border-bottom:3px solid #e8192c}
`;

/** The whole page: header, facts, this page's body, and the rotation footer. */
export function renderTv(d: TvData, page: TvPage, secs: number): string {
  const pages = tvPages(d);
  const at = Math.max(0, pages.indexOf(page));
  const next = (at + 1) % pages.length;
  const body = {
    now: pageNow, headlines: pageHeadlines, market: pageMarket, roads: pageRoads,
    radar: pageRadar, fights: pageFights, printer: pagePrinter,
  }[page](d);
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta http-equiv="refresh" content="${secs};url=/tv?p=${next}&amp;s=${secs}">
<title>LOCAL 24</title>
<style type="text/css">${CSS}</style>
</head><body>
${header(d)}
${facts(d)}
<div class="pagetitle">${e(TITLES[page].toUpperCase())}</div>
${body}
${footer(pages, page, secs)}
</body></html>`;
}
