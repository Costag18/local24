# LOCAL 24

A personal CP24-style information channel. Runs on this laptop, binds to
`127.0.0.1` only, and is glanceable from across the room but clickable up close.

Double-click **`LOCAL 24.cmd`**. First run installs and builds (about a minute),
then opens fullscreen in Chrome.

- Dashboard — <http://127.0.0.1:3100>
- Settings — <http://127.0.0.1:3100/settings>
- Source health — <http://127.0.0.1:3100/health>

## First run

Channels start empty on purpose — a YouTube channel id can't be guessed
reliably, and a wrong one is a silently broken channel. Pick a channel in the
main pane and paste any YouTube URL (video, playlist, or a channel's `/live`
page); a direct `.m3u8` stream works too. It's remembered from then on.

Everything else — weather, news, traffic, cameras, fight cards — works
immediately with no keys and no accounts.

## Layout

```
┌─ clock ─ date ──────────────────── temp ─ condition ─┐
├────────────────────────────┬─────────────────────────┤
│  MAIN PANE                 │  WEATHER   pinned       │
│  true 16:9, never          │  now / hourly / 5-day   │
│  auto-switches, keys 1-9   ├─────────────────────────┤
│                            │  CAMERAS                │
│                            │  starts higher than the │
├────────────────────────────┤  panel opposite it —    │
│  FIGHTS · tech · traffic · │  hero + 3 thumbs        │
│  transit · crime           │  ⛶ full wall            │
├────────────────────────────┴─────────────────────────┤
│  TICKER CRAWL                                        │
└──────────────────────────────────────────────────────┘
```

The top-left video area is sized to a true **16:9** — the grid is measured and
solved rather than fractional, so a stream never letterboxes and the other
panels absorb every remaining pixel. The two columns then split independently,
so the camera panel sits higher than the panel across from it rather than
locking into a rigid 2x2.

The bottom-left bar is deliberately short and **scrolls itself** as a vertical
carousel when its list is taller than the bar; it pauses the moment you touch
anything.

The main pane **never** switches on its own. Everything else rotates, pauses the
moment you touch anything, and resumes after 60s idle.

## Keyboard

| Key | |
|---|---|
| `1`–`9` | Switch channel |
| `←` `→` | Previous / next channel |
| `C` | Camera wall (then `1`/`4`/`9` for grid size) |
| `P` | Pin / unpin the current camera |
| `K` | Kiosk mode |
| `Ctrl+K` | Command palette — any channel, any of 2000+ cameras, full-text search |
| `R` | Refresh all sources |
| `N` | Night mode |
| `S` / `H` | Settings / health |
| `+` `−` | Font size |
| `?` | Shortcuts |

## Where the data comes from

All free, all keyless, all verified working on 2026-09-09.

| | |
|---|---|
| Highway cams, closures, road conditions | Ontario 511 |
| City cameras | City of Toronto open data (ArcGIS) |
| Weather, alerts, sunrise/sunset | Environment Canada (`api.weather.gc.ca`) |
| Rain nowcast, air quality | Open-Meteo |
| Local news + crime | CityNews Toronto, CBC Toronto, Global Toronto |
| Tech news | The Verge, Ars Technica, Hacker News |
| Fight cards | ufc.com, onefc.com, pflmma.com |
| Live video cams | 11 public YouTube live streams, cycling; editable in Settings |
| TTC alerts | `alerts.ttc.ca/api/alerts/live-alerts` — delays, closures, diversions |

There are no deals or specials anywhere — they read as ads, so the feature was
removed entirely rather than hidden.

Crime blurbs are keyword-filtered from local news rather than a police feed —
Toronto Police open data only publishes through the *previous* calendar year, so
it can't answer "what happened today". CP24's own RSS has been 404 since their
2024 redesign; CityNews is the same newsroom.

## Notes on behaviour

- **Nothing ever blanks.** Every tile keeps its last good value and marks how old
  it is. If something looks stale, `/health` says which source failed and why.
- **One dead source can't take the rest down.** Each has independent timers and
  exponential backoff.
- **Cameras are snapshots, not video.** Measured 2026-09-09: Toronto publishes a
  new frame about once a minute, Ontario 511 about every twenty seconds, and
  neither offers a video stream. So the panel gives its main area to a **live
  YouTube stream** and cycles the snapshots in a strip underneath, showing each
  picture's real age — a quiet street then reads as quiet, not broken. Remove
  every live cam in Settings to get a large snapshot camera back instead. Eleven
  live cams ship by default and cycle every 45s; each was verified live and
  embeddable rather than guessed.
- Only the promoted snapshot is proxied through the server, which is what makes
  frozen-feed detection and the rewind slider possible. Strip thumbnails load
  straight from the source. A camera that fails is skipped and retried in 15 min.
- **Laptop-aware** — on battery, polling slows and camera refresh backs off.
  Data-saver caps it further and pauses video. Video also pauses when the tab is
  hidden.
- **Fight cards** — an event happening today pins the panel with its poster,
  countdown, and bout order, and stops rotating away until it's over. If a
  promotion changes its markup, add the card by hand in `data/config.json`
  (`manualFightCards`) and it overrides the scrape.

## Sections

The layout is data, not markup. Each column is a stack of section slots in
`data/config.json`, editable from Settings — reorder, move a section between
columns, change its share of the height, or swap one out entirely:

`video` · `panels` (the rotating one) · `weather` · `map` · `cameras`, plus any
single panel pinned open: `fights` · `tech` · `traffic` · `transit` · `crime`.

A share of `0` means the section sizes to its own content, which is what lets
weather shrink so the panels beneath it rise. The channel video holds a true
16:9 whenever it leads the left column. A hand-edited layout that is empty,
duplicated or misspelled is repaired on load rather than blanking the screen.

## Config

Everything lives in `data/config.json`, editable from Settings or by hand.
Export/import from Settings — that file is also how you'd move this to a server
later.

## Development

```bash
npm run dev        # http://127.0.0.1:3100
npm test           # 135 parser + logic tests
npm run typecheck
```

Parsers are tested against saved fixtures in `tests/fixtures/`. When an upstream
site changes its markup, refresh the fixture and the parser together.

## Later: running it for other screens

The seam is already in place — sources write to SQLite, the UI only ever reads
from the local API, and state pushes over SSE. Serving other machines means
changing the bind from `127.0.0.1` to `0.0.0.0` and adding a shared token.
It is deliberately localhost-only today.

Design notes: `docs/superpowers/specs/2026-09-09-local24-design.md`
