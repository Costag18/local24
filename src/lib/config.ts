import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "./types";
import { DEFAULT_LAYOUT, PANEL_SECTIONS, normalizeLayout } from "./layout";
import { defaultTree, safeTree } from "./panes";

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

/** Downtown Toronto. The first-run wizard overwrites this. */
export const DEFAULT_CONFIG: AppConfig = {
  layout: DEFAULT_LAYOUT,
  layoutTree: defaultTree(),
  layoutDefault: defaultTree(),
  layoutPresets: [],
  place: { label: "Toronto", lat: 43.6532, lon: -79.3832 },
  camRadiusKm: 8,

  // Refs start empty on purpose. A YouTube channel id cannot be guessed
  // reliably, and a wrong one is a silently broken channel — so the pane asks
  // for the URL once and remembers it. Paste any YouTube link (video,
  // playlist, channel, or channel/live) or a direct .m3u8 stream.
  /**
   * Channel refs rather than video ids: a channel's /live plays whatever that
   * channel is streaming now, so a restream under a new id keeps working. The
   * three that ship are ones that are genuinely on around the clock — a wall
   * of empty slots was worse than a short list that plays.
   */
  channels: [
    { id: "cbc", label: "CBC News", type: "youtube-live", ref: "https://www.youtube.com/channel/UCuFFtHWoLl5fauMMD5Ww2jA/live", accent: "#e11d2e" },
    // A produced live broadcast: GTA weather, radar and highway cameras.
    { id: "gtaweather", label: "GTA Weather", type: "youtube-live", ref: "https://www.youtube.com/channel/UCgSr23wNvzPimjjIbkYDfRQ/live", accent: "#38bdf8" },
    { id: "lofi", label: "Lofi", type: "youtube-live", ref: "https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow/live", accent: "#a855f7" },
    // Comma-separated sources play as one mixed channel: Groundeffected's
    // uploads (a bare UC id), RelentlesStorm's "How to Paint 3D Printed
    // Models" playlist and Ashe's Crafting Corner, alternating, starting somewhere different each time.
    { id: "groundeffected", label: "3D Painting", type: "youtube", ref: "UCsrAdYJzB20KmtJtN7hB8nQ, PL6ZkL6WewfuH1f-EJ96lp7WG8weMLiG1x, UCvpXYDrONljnEkvLhPlyTGw", accent: "#16a34a" },
    { id: "familyguy", label: "Family Guy", type: "youtube", ref: "", accent: "#2dd4bf" },
    { id: "ufc", label: "UFC", type: "youtube", ref: "", accent: "#d20a0a" },
  ],

  playlists: [
    // East York, from the camera catalogue: Danforth, O'Connor, Don Mills,
    // Bayview/Pottery, Eglinton and the DVP through the area.
    {
      id: "easyork",
      label: "East York",
      dwellMs: 12000,
      camIds: [
        "to:8215", "to:8216", "to:8183", "to:8182", "to:8214", "to:8217",
        "to:8140", "to:8139", "to:8089", "to:8088", "to:8059", "to:8060",
        "to:8061", "to:8057", "to:8101", "to:8223", "to:8224", "to:8099",
        "to:9111", "to:9106",
      ],
    },
    { id: "downtown", label: "Downtown Core", camIds: [], dwellMs: 12000 },
    { id: "highways", label: "Highways", camIds: [], dwellMs: 12000 },
    { id: "nearme", label: "Near Me", camIds: [], dwellMs: 12000 },
  ],

  // Toronto only. Each was verified by fetching the watch page and confirming
  // "isLive":true and embeddable — searching "live cam" mostly returns
  // archives. Public live *video* of Toronto is genuinely scarce; these are
  // what exists. Streams end, so swap URLs in Settings when one goes dark.
  videoCams: [
    { id: "tor-skyline", label: "CN Tower / Lake Ontario", ref: "https://www.youtube.com/watch?v=bbjwotvAvDM" },
    { id: "tor-rail", label: "Toronto Railcam", ref: "https://www.youtube.com/watch?v=HongS1sx4pY" },
  ],

  // Yours to fill in. A snapshot or MJPEG URL from the camera's own web
  // interface works; RTSP does not play in a browser.
  homeCams: [],

  scenes: [
    {
      id: "default", label: "Default", hotkey: null, channelId: "citynews",
      playlistId: "nearme", panels: ["fights", "tech", "traffic", "transit", "crime"],
      density: "comfortable", fontScale: 1,
    },
  ],

  // East York, zoomed in on St Clair & O'Connor, the corner by Parkview Hills.
  map: {
    label: "East York",
    // Just the buses that matter at St Clair & O'Connor.
    routes: ["93", "91", "70", "8"],
    // The data window: the view plus a small margin.
    bounds: { latMin: 43.682, latMax: 43.73, lonMin: -79.352, lonMax: -79.274 },
    // Centred on St Clair Ave E & O'Connor Dr, about 2.7 x 3.4 km.
    view: { latMin: 43.6935, latMax: 43.718, lonMin: -79.3335, lonMax: -79.2915 },
    // OSM route relations: Line 2 Bloor-Danforth, Line 1 Yonge-University.
    // The TTC feed has no subway routes, so the geometry comes from OSM.
    subwayRelations: [102386, 102388],
    // St Clair Ave East at Denvale Rd, southbound towards Woodbine Station.
    departures: [{ route: "93", stop: "1658", direction: "93_0", label: "93 South · Denvale" }],
    showStops: false,
    showCameras: true,
    showIncidents: true,
  },



  // Radar rotates with the weather and the printer with the home camera,
  // so neither needs a page here.
  // TTC and traffic alerts rotate with the bus map instead (SectionHost).
  panels: ["fights", "tech", "events", "market", "ideas", "sellers", "leads", "print3d", "crime"],
  panelDwellMs: 30_000,
  camBandDwellMs: 10000,
  videoCamDwellMs: 20000,
  camRefreshMs: 5000,
  camFrameBuffer: 60,

  // Alerts naming these are lifted to the top and highlighted in the text.
  transitPlaces: [
    "Broadview", "Danforth", "Pape", "Donlands", "Greenwood", "Coxwell",
    "Woodbine", "Main Street", "Victoria Park", "O'Connor", "Cosburn",
    "Don Mills", "Eglinton", "Thorncliffe", "Leaside", "Parkview Hills",
    "Chester", "Castle Frank", "Broadview Station",
  ],

  transitStops: [],
  routesOfInterest: ["401", "DVP", "GARDINER", "QEW", "404", "427"],

  news: {
    weights: {
      // Curated beats raw: a Techmeme line is already the summary.
      "news.techmeme": 1.7,
      "news.bbc-tech": 1.4,
      "news.ars": 1.1,
      "news.techcrunch": 1.0,
      // Kept for launches, but it writes a lot of lifestyle copy.
      "news.verge": 0.75,
      "news.citynews": 1.0,
      "news.cbc-toronto": 1.0,
      "news.global-toronto": 0.9,
    },
    boost: [],
    mute: [],
    crimeKeywords: [
      "police", "shooting", "stabbing", "homicide", "arrest", "charged",
      "robbery", "assault", "carjacking", "break-in", "fatal", "collision",
      "suspect", "investigation", "manhunt",
    ],
  },

  ticker: {
    mix: { headlines: 0.55, traffic: 0.35, custom: 0.1 },
    custom: ["LOCAL 24 — your channel, your city"],
    speed: 55,
  },

  ui: {
    theme: "cp24",
    accent: "#e11d2e",
    density: "comfortable",
    fontScale: 1,
    idleResumeMs: 60000,
    burnInProtection: true,
    nightModeFrom: null,
    nightModeTo: null,
    dndFrom: "23:00",
    dndTo: "07:00",
    chimeOnAlert: false,
  },

  power: {
    batterySaver: true,
    dataSaver: false,
    dataSaverCamRefreshMs: 20000,
  },

  sourceIntervalOverrides: {},
  mutedWidgets: [],
  manualFightCards: [],

  // Parkview Hills. 8 km reaches the Danforth, Leaside and the Brick Works.
  events: { center: { lat: 43.7005, lon: -79.3255 }, radiusKm: 8 },

  printer: { label: "Printer", host: "", serial: "", accessCode: "" },

  // St Clair Ave E at Denvale Rd, the 93 stop. Move it to your door in
  // Settings if the collection calendar comes out wrong.
  home: { label: "Home", lat: 43.70438, lon: -79.31837 },
  pickupCalendar: "",

  // Searches tuned to what a print-and-paint shop makes: figures, cosplay,
  // signs, decor, car parts, games. Broad on purpose; titles that are printer
  // hardware are filtered out.
  business: {
    ebayQueries: [
      "3d printed", "3d printed figure", "3d printed cosplay", "3d printed sign",
      "3d printed planter", "3d printed dragon", "3d printed car", "3d printed organizer",
      "3d printed miniature", "3d printed gift",
    ],
  },

  market: {
    enabled: true,
    sources: ["facebook", "kijiji", "karrot"],
    cities: [
      "Toronto", "East York", "North York", "Scarborough", "York", "Etobicoke",
      "Markham", "Thornhill", "Richmond Hill", "Pickering", "Vaughan",
    ],
    radiusKm: 25,
    searches: [
      {
        id: "games",
        label: "Games",
        queries: ["video games", "nintendo", "playstation", "xbox"],
        match: String.raw`game|ps[1-5]|playstation|xbox|nintendo|switch|wii|gamecube|n64|snes|\bnes\b|sega|game ?boy|\b3?ds\b|controller|console|zelda|mario|pok[eé]mon|steam deck`,
        exclude: String.raw`board game|gaming (chair|desk|pc)|card game`,
      },
      {
        id: "printers",
        label: "3D printers",
        queries: ["3d printer"],
        match: String.raw`3d printer|printer|bambu|creality|prusa|elegoo|anycubic|ender|voron|qidi|flashforge|resin`,
        exclude: String.raw`3d[- ]?printed|laser printer|inkjet|label printer|tattoo|stencil|receipt`,
      },
      {
        id: "filament",
        label: "Filament",
        queries: ["3d filament", "pla filament"],
        match: String.raw`filament|\bpla\b|petg|\babs\b|\btpu\b|spool`,
        exclude: String.raw`3d[- ]?printed|light bulb|lamp`,
      },
      {
        // People nearby asking for something to be printed: customers.
        id: "leads",
        label: "Requests",
        queries: ["3d printing", "3d print"],
        match: String.raw`3d|print`,
        // A listing selling a printer "that needs a part" is not someone asking for a print.
        exclude: String.raw`^(?!.*(looking for|anyone|someone|who can|wanted|\biso\b)).*(printer|filament)|for sale|comes with|\bobo\b|selling`,
        wanted: true,
      },
    ],
  },
};

let cached: AppConfig | null = null;
let cachedStamp = 0;

/**
 * Deep-merges the saved config over the defaults so a config written by an
 * older version keeps working when new keys are added.
 */
function merge<T>(base: T, over: unknown): T {
  if (over === null || over === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object") return over as T;
  if (typeof over !== "object") return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    out[k] = k in (base as Record<string, unknown>)
      ? merge((base as Record<string, unknown>)[k], v)
      : v;
  }
  return out as T;
}

/**
 * Drops what a config written by an older version carries but this one no
 * longer has. The merge keeps unknown saved keys (so a newer file survives an
 * older build), which means a removed feature would otherwise linger — deals
 * were taken out entirely, and must not come back through a saved page list,
 * scene or ticker mix.
 */
function scrub(c: AppConfig): AppConfig {
  const pages = new Set<string>(Object.values(PANEL_SECTIONS));
  const keep = (list: unknown) => (Array.isArray(list) ? list : []).filter((p) => pages.has(p));
  const raw = c as unknown as Record<string, unknown>;
  delete raw.deals;
  const mix = { ...(c.ticker.mix as Record<string, number>) };
  delete mix.deals;
  return {
    ...c,
    panels: keep(c.panels),
    scenes: c.scenes.map((s) => ({ ...s, panels: keep(s.panels) })),
    ticker: { ...c.ticker, mix: mix as AppConfig["ticker"]["mix"] },
  };
}

/** Stands in for a secret in anything sent to the browser. */
export const SECRET_MASK = "••••••••";

/**
 * The config as the browser may see it.
 *
 * The dashboard is reachable from the whole local network, so the printer's
 * access code — which grants control of the printer — is replaced with a
 * mask. Settings sends the mask back unchanged, and `saveConfig` keeps the
 * stored code when it does.
 */
export function publicConfig(c: AppConfig): AppConfig {
  return { ...c, printer: { ...c.printer, accessCode: c.printer.accessCode ? SECRET_MASK : "" } };
}

/** Modification time of the file the cache was built from. */
function configStamp(): number {
  try {
    return statSync(CONFIG_PATH).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * The cache is keyed on the file's modification time.
 *
 * Next gives each route handler its own copy of this module in development, so
 * a write through /api/config only refreshes *that* copy — every other route
 * would go on serving the config it read at startup. Checking the stamp costs
 * one stat and makes every instance agree.
 */
export function loadConfig(): AppConfig {
  if (cached && cachedStamp === configStamp()) return cached;
  try {
    if (existsSync(CONFIG_PATH)) {
      const stamp = configStamp();
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      const merged = scrub(merge(DEFAULT_CONFIG, raw));
      merged.layout = normalizeLayout(merged.layout);
      merged.layoutTree = safeTree(merged.layoutTree);
      merged.layoutDefault = safeTree(merged.layoutDefault);
      cached = merged;
      cachedStamp = stamp;
      return cached;
    }
  } catch (err) {
    console.error("[config] unreadable, falling back to defaults:", err);
  }
  cached = DEFAULT_CONFIG;
  cachedStamp = configStamp();
  return cached;
}

export function saveConfig(next: AppConfig): AppConfig {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const merged = scrub(merge(DEFAULT_CONFIG, next));
  // The browser only ever has the mask; it means "leave the code as it is".
  if (merged.printer.accessCode === SECRET_MASK) {
    merged.printer = { ...merged.printer, accessCode: loadConfig().printer.accessCode };
  }
  merged.layout = normalizeLayout(merged.layout);
  merged.layoutTree = safeTree(merged.layoutTree);
  merged.layoutDefault = safeTree(merged.layoutDefault);
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf8");
  cached = merged;
  cachedStamp = configStamp();
  return merged;
}

export function patchConfig(patch: unknown): AppConfig {
  return saveConfig(merge(loadConfig(), patch));
}

export function resetConfigCache(): void {
  cached = null;
}
