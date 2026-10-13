# LOCAL 24 — design

A personal CP24-style information channel, run locally on one laptop.
Glanceable from across the room, clickable up close.

Date: 2026-09-09

## Goal

One screen that answers "what is happening right now" for *this* user:
tech news, Toronto crime and traffic, weather, upcoming MMA cards, and a large
rotating wall of public traffic cameras — wrapped in the visual language of
CP24's on-air layout.

## Non-goals (v1)

- No multi-user auth, no cloud, no public exposure. Binds to `127.0.0.1` only.
- No serving other screens on the LAN. The architecture leaves the seam for it
  (see Deployment), but v1 does not implement discovery, tokens, or sync conflict.
- No re-hosting of third-party video. Channels are embeds/links, not proxied streams.
- No private/unsecured camera feeds. Only published municipal and provincial cams.

## Reference: what CP24 actually puts on screen

Researched 2026-09-09 to ground the layout:

- Video window occupying roughly 2/5 of the screen, **top-left**.
- An L-bar wrapping it: current conditions, day's forecast, a **4-day** synopsis,
  live traffic flow sourced from ~118 highway cameras, a scrolling headline
  crawl, a stock ticker, and local entertainment/lottery/gas-price filler.
- Date and time permanently visible.
- Breaking-news treatment that overrides the normal layout.

LOCAL 24 keeps this skeleton and swaps the content for the user's own priorities.

## Data sources

All verified live on 2026-09-09 against a scripted (non-browser) request.

| Domain | Source | Endpoint | Auth |
|---|---|---|---|
| Highway cams | Ontario 511 | `https://511on.ca/api/v2/get/cameras` | none |
| Road incidents | Ontario 511 | `https://511on.ca/api/v2/get/event` | none |
| Road conditions | Ontario 511 | `https://511on.ca/api/v3/get/roadconditions` | none |
| City cams (336) | Toronto ArcGIS | `gis.toronto.ca/arcgis/rest/services/cot_geospatial2/FeatureServer/3/query` | none |
| Camera stills | Toronto Open Data | `opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/locNNNN.jpg` | none |
| Weather, alerts, sunrise | Environment Canada | `api.weather.gc.ca/collections/citypageweather-realtime/items` | none |
| Precip nowcast | Open-Meteo | `api.open-meteo.com/v1/forecast` (`minutely_15`) | none |
| Air quality | Open-Meteo | `air-quality-api.open-meteo.com/v1/air-quality` | none |
| Transit | TTC (legacy NextBus JSON) | `retro.umoiq.com/service/publicJSONFeed?command=predictions&a=ttc` | none |
| Local news | CityNews Toronto | `toronto.citynews.ca/feed/` | none |
| Local news | CBC Toronto | `cbc.ca/webfeed/rss/rss-canada-toronto` | none |
| Local news | Global Toronto | `globalnews.ca/toronto/feed/` | none |
| Tech news | The Verge | `theverge.com/rss/index.xml` | none |
| Tech news | Ars Technica | `feeds.arstechnica.com/arstechnica/index` | none |
| Tech news | Hacker News | `hnrss.org/frontpage` | none |
| UFC cards | ufc.com | reuse `fight night board` parser | none |
| PFL / ONE cards | official schedule pages + Wikipedia cross-check | scrape | none |

### Rejected sources — do not re-propose without re-testing

- **CP24 RSS** — all feed paths 404 since the 2024 digital redesign. CityNews
  Toronto is the same newsroom; use it instead.
- **TPS `/api/news`** — returns 403 to scripted requests.
- **TPS open data (Major Crime Indicators)** — only published through the end of
  the *previous* calendar year. Useless for "recent crime". Crime blurbs are
  derived from keyword-filtered local news RSS instead.
- **ufcstats.com** — JavaScript proof-of-work browser check (per prior project).
- **ESPN `site.api.espn.com`** — 403 to scripted requests (per prior project).
- **Stooq CSV (stock quotes)** — 404 on the documented quote path. No free,
  keyless quote source was found, so **stocks are out of the v1 ticker**. The
  ticker's third stream is user-pinned custom messages instead. Revisit only if
  the user supplies an API key for a quote provider.
- **`dd.weather.gc.ca` XML and `weather.gc.ca/rss/*`** — all 404; the paths moved.
  `api.weather.gc.ca` is the current Environment Canada surface.
- **`webservices.umoiq.com/api/pub/v1`** — 401 without a key. The legacy
  `retro.umoiq.com` JSON feed is keyless and returns live TTC predictions.

## Architecture

Single Next.js 15 process (React 19, Tailwind 4, TypeScript), matching the
toolchain already used by `fight night board` so the UFC parser can be lifted
directly.

```
  ┌───────────────────────────────────────────────┐
  │ Poller (server, setInterval per source)        │
  │   Source.fetch() → parse() → normalize()       │
  └────────────────────┬──────────────────────────┘
                       │ writes
                  ┌────▼─────┐
                  │  SQLite  │  node:sqlite (built-in, FTS5)
                  └────┬─────┘
                       │ reads
  ┌────────────────────▼──────────────────────────┐
  │ /api/* route handlers  +  WebSocket broadcast  │
  └────────────────────┬──────────────────────────┘
                       │
                  ┌────▼─────┐
                  │    UI    │  never fetches a source directly
                  └──────────┘
```

### The Source contract

Every ingest is one module implementing:

```ts
interface Source<T> {
  id: string;              // 'cams.511', 'news.verge', ...
  interval: number;        // ms; overridable per-source in config
  fetch(): Promise<unknown>;
  parse(raw: unknown): T[];
  normalize(parsed: T[]): Row[];
}
```

The UI reads only from the cache API. This is the seam that makes server mode a
config change rather than a rewrite: one screen or five, the read path is identical.

### Storage

`node:sqlite` (`DatabaseSync`), verified to include FTS5 on Node 24.14.1. No
native compilation, no build toolchain. DB file lives in the project directory.

Tables: `items` (normalized feed rows), `items_fts` (FTS5 over title+body),
`cams`, `cam_frames` (ring buffer for scrub-back), `source_health`, `config`.

### Deployment (v1: laptop)

- `next dev -H 127.0.0.1` / `next start -H 127.0.0.1`. Explicitly localhost.
- `LOCAL24_BIND` env var flips to `0.0.0.0` for the later server mode; a shared
  token guard is the only other thing that step needs.
- Launcher `.cmd` + `launch.ps1`, mirroring the `fight night board` pattern:
  install-if-missing, build-if-missing, wait for health, open fullscreen.
- Single-instance guard; auto-restart on crash.

## Layout

```
┌─ 14:32  TUE SEP 9 ──────────────── 21°C  Feels 24° ─┐
├──────────────────────────────┬──────────────────────┤
│                              │  WEATHER   (pinned)  │
│   MAIN PANE                  │  now / hourly        │
│   ◄ manual channel switch ►  │  4-day strip         │
│                              ├──────────────────────┤
│                              │  CYCLE PANEL         │
│                              │  fights → tech →     │
│                              │  traffic → transit → │
├──────────────────────────────┤  local crime         │
│  CAMERA BAND [hero][·][·][·] │                      │
├──────────────────────────────┴──────────────────────┤
│  ▸ TICKER CRAWL ────────────────────────────────────│
└─────────────────────────────────────────────────────┘
```

### Main pane — channels

Manually switched only; **never** auto-advances. Channels are declared in config,
each one of: YouTube embed, HLS URL, or local file. Seeded with:

1. Local Toronto news livestream
2. Bodycam footage
3. House-building videos
4. Bob Ross
5. Japanese game shows

Number keys 1–9 jump directly; arrows step; last channel persists across reloads.
Some YouTube livestreams refuse embedding — on embed failure the player shows an
"open on youtube.com" card rather than a black rectangle.

### Camera band

First-class, not a tile — 448 cameras available (336 city + 511 highway).
Rotating hero plus three thumbnails. Click a thumbnail to promote it to hero.

A **⛶ icon** on the hero tile expands cameras to fill the whole screen in a
grid (2×2 / 3×3 selectable) rotating as a playlist; Esc or the icon returns.
The band is the default; takeover is opt-in per click.

- JPEG cams poll on an interval; a frame-hash comparison detects a frozen or
  dead feed and auto-skips it with a badge.
- Named playlists with per-playlist dwell time.
- Map picker to build playlists; "cams near me" suggests by radius from home.
- Pin a camera so rotation never drops it; snapshot a frame to disk.
- **Frame buffer**: a ring buffer of the last 60 frames per camera (~5 minutes
  at the 5s default refresh), scrubbable. Identical frames are not re-stored,
  so a frozen camera does not consume the buffer.

### Weather

Pinned, always visible. Current conditions, hourly strip, 4-day forecast,
rain-starting-in-X-minutes nowcast, sunrise/sunset daylight bar, air quality.
Severe alerts trigger an audio chime and a full-screen takeover.

### Cycle panel

Auto-rotating. Panels: fight cards, tech headlines, traffic, transit, local crime.

**Fight cards** — UFC via the lifted `fight night board` parser; PFL and ONE by
scraping their schedule pages with Wikipedia as a cross-check, and a manual
override in config as the safety valve when a scrape breaks. On the day of an
event the card is **pinned** to the panel with its poster, a countdown to
main-card start, and the full bout order; it stops rotating away until the event
ends. Times convert to local; `.ics` export.

### News

Tech-weighted by default (Verge / Ars / HN lead), local crime as a second stream
from keyword-filtered Toronto RSS. Per-source weights, keyword boost/mute, and
dedupe collapsing the same story from multiple outlets into one.

### Traffic

511 events, severity-sorted, rendered as a jam list with impact notes. Full
closures on user-named routes raise a breaking banner.

### Ticker

Composable: the mix of **headlines / traffic / custom messages** is user-set as
proportions. Stocks are deliberately excluded from v1 (no keyless quote source —
see Rejected sources); user-pinned custom messages take that slot.

## Interaction model

Kiosk is a mode, not a separate app.

- `?kiosk=1` for the dedicated screen; interactive at the root.
- Any interaction pauses rotation; 60s idle resumes it.
- Full keyboard navigation; `?` shows the cheat sheet.
- Command palette (Ctrl+K) jumps to any channel, camera, or widget by name.
- Drag-to-rearrange, with resizable regions and named layout presets.

## Laptop-specific behaviour

- **Battery awareness**: on battery, poll rates drop, camera refresh slows,
  video pauses when hidden.
- **Data-saver**: manual or auto on metered connections; caps camera refresh and
  video quality. A running data-usage counter shows the cost.
- **Burn-in protection**: subtle periodic pixel-shift in kiosk mode.
- Auto-dim / night mode on a clock schedule; do-not-disturb window silences chimes.

## Customization

- **Scenes** — named snapshot of layout + channel + camera playlist + widget set,
  bound to a hotkey ("Morning", "Fight night", "Storm watch").
- Per-widget refresh override and per-widget mute.
- Font-scale slider and density toggle, for desk vs across-the-room viewing.
- Theme: CP24-authentic red/blue or a custom accent; source-colour-coded headlines.
- Whole config exports as a single JSON file — which is also the migration path
  to server mode.

## Reliability

- Every tile carries a stale-data timestamp. Never a blank box — last good value
  plus "3m ago".
- Per-source backoff on failure; one dead feed cannot stall the others.
- **Source health page**: last success, last error, latency, per source.
- Offline banner on connectivity loss.
- Full-text search across everything ingested, with history.

## Testing

Vitest, matching `fight night board`.

- **Parsers** are tested against saved HTML/JSON fixtures in `tests/fixtures/`.
  When an upstream markup change breaks a parser, the fixture and the parser are
  refreshed together.
- **Normalizers** are tested for dedupe, keyword filtering, and weighting.
- **Degradation** is tested explicitly: a source that throws, a source that
  returns malformed data, and a camera that returns an identical frame must all
  leave the UI rendering with stale-marked data.

## Build order

Each phase leaves a running, viewable app. Appearance and behaviour are checked
in the browser at the end of every phase, not saved for the end.

1. **Skeleton** — Next.js + Tailwind + `node:sqlite`, CP24 shell layout with the
   clock bar, empty regions, correct proportions. Verifiable on screen.
2. **Source layer + poller** — Source contract, SQLite schema, source health.
   Weather and news wired first; tiles show real data with stale timestamps.
3. **Cameras** — ingest both catalogues, band, rotation, dead-feed detection,
   fullscreen takeover.
4. **Channels** — main-pane switcher, embed-failure card, persistence.
5. **Cycle panel** — fights (UFC parser lifted, PFL/ONE scrape + override),
   traffic, transit, crime.
6. **Ticker + breaking-news takeover.**
7. **Interaction** — kiosk mode, keyboard nav, command palette, idle resume.
8. **QoL and customization** — scenes, layout editor, battery/data-saver,
   burn-in protection, search, config export.

## Risks

- **Scraped sources break.** UFC/PFL/ONE parsers are fixture-tested, and every
  scraped panel has a manual config override so the screen degrades to
  user-entered data rather than to nothing.
- **Camera endpoints rate-limit.** Per-source backoff plus data-saver caps; the
  frame-hash check also avoids re-storing identical frames.
- **YouTube embed restrictions** vary per channel and can change without notice.
  Handled by the embed-failure card.
