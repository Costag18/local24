// Shared shapes. Everything the UI renders passes through one of these, so a
// new source only has to produce a known row type to appear on screen.

export type ItemKind = "tech" | "local" | "crime" | "traffic" | "transit" | "fight" | "print3d" | "lead";

/** A normalized feed row. One table, one shape, discriminated by `kind`. */
export interface Item {
  id: string; // stable hash of source+link, so re-polling does not duplicate
  kind: ItemKind;
  sourceId: string;
  title: string;
  body: string;
  link: string;
  published: number; // epoch ms
  fetched: number; // epoch ms
  weight: number; // ranking score after per-source weight + keyword boost
  meta: Record<string, unknown>;
}

export interface Camera {
  id: string; // e.g. "to:8001" or "on511:1"
  network: "toronto" | "ontario511";
  label: string;
  roadway: string;
  cross: string;
  lat: number;
  lon: number;
  imageUrl: string;
  /** Set when a frame-hash comparison shows the feed is frozen or erroring. */
  dead: boolean;
  lastFrameHash: string | null;
  lastOk: number | null;
}

export interface TrafficEvent {
  id: string;
  roadway: string;
  direction: string;
  description: string;
  severity: string;
  eventType: string;
  isFullClosure: boolean;
  lat: number;
  lon: number;
  updated: number;
}

export interface Weather {
  place: string;
  observed: number;
  tempC: number | null;
  feelsLikeC: number | null;
  condition: string;
  iconUrl: string | null;
  humidity: number | null;
  windKph: number | null;
  windDir: string | null;
  sunrise: number | null;
  sunset: number | null;
  aqi: number | null;
  /** UV index right now; only worth showing in daylight when it is 3 or more. */
  uv?: number | null;
  /** Next 15-minute precipitation buckets, for the "rain in X min" nowcast. */
  nowcast: { at: number; mm: number }[];
  hourly: { at: number; tempC: number; condition: string; pop: number | null }[];
  daily: { day: string; hiC: number | null; loC: number | null; condition: string; pop: number | null }[];
  warnings: { title: string; type: string; url: string | null }[];
}

export interface Fight {
  bout: string;
  weightClass: string;
  redName: string;
  blueName: string;
  isMain: boolean;
  isTitle: boolean;
}

/** A City of Toronto calendar event near home. */
export interface LocalEvent {
  /** The calendar's submission id: one per event, however many dates it has. */
  id: string;
  name: string;
  venue: string;
  /** From the configured centre; null when the listing has no coordinates. */
  distanceKm: number | null;
  /** Upcoming start times, ascending, in epoch ms. */
  dates: number[];
  free: boolean;
  /** Marked featured by the City — shown even when it is not nearby. */
  featured: boolean;
  categories: string[];
  link: string;
  /**
   * Open most days of the coming week — an exhibit or a run of shows rather
   * than a one-off. Set when the state is built.
   */
  ongoing?: boolean;
}

export interface FightCard {
  id: string;
  promotion: "UFC" | "PFL" | "ONE";
  name: string;
  /** Main-card start, epoch ms. Null when the promotion has not posted a time. */
  startsAt: number | null;
  venue: string;
  location: string;
  posterUrl: string | null;
  link: string;
  fights: Fight[];
  /** True when the event is today and has not finished — pins the panel. */
  isToday: boolean;
  /** True between the main-card start and the end of the broadcast. */
  live?: boolean;
  source: "scrape" | "manual";
}

/** Per-source liveness, surfaced on the health page and as tile staleness. */
export interface SourceHealth {
  sourceId: string;
  lastAttempt: number | null;
  lastSuccess: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  latencyMs: number | null;
  bytes: number; // cumulative, feeds the data-usage counter
}

export interface Channel {
  id: string;
  label: string;
  /** youtube = embed by video/channel id; hls/file = direct player. */
  type: "youtube" | "youtube-live" | "hls" | "file";
  ref: string;
  accent?: string;
}

/**
 * A live video camera. Neither Toronto nor Ontario 511 publishes video — both
 * are JPEG snapshots — so real motion has to come from public live streams
 * (YouTube live, or a direct HLS URL). Same ref parser as channels.
 */
export interface VideoCam {
  id: string;
  label: string;
  ref: string;
}

/**
 * A camera on the local network.
 *
 * Browsers can render a still JPEG or an MJPEG stream directly; RTSP they
 * cannot play at all without a transcoder. Most consumer cameras expose a
 * snapshot or MJPEG endpoint alongside RTSP, and that is what this uses.
 */
export interface HomeCam {
  id: string;
  label: string;
  /**
   * `snapshot` re-fetches a still, `mjpeg` is a continuous stream, and `nest`
   * is a Google camera read off a signed-in browser window — see lib/nest.
   */
  kind: "snapshot" | "mjpeg" | "nest";
  /**
   * A camera URL, which may embed credentials (http://user:pass@host/...) —
   * they stay server-side. For `nest`, the home.google.com page for that
   * camera.
   */
  url: string;
  /** Snapshot only — how often to pull a new still. */
  refreshMs: number;
}

export interface CamPlaylist {
  id: string;
  label: string;
  camIds: string[];
  dwellMs: number;
}

/** One garbage collection: a local date (YYYY-MM-DD) and what goes out. */
export interface Pickup {
  date: string;
  items: string[];
}

/** A local listing from Facebook Marketplace, Kijiji or Karrot. */
export interface Listing {
  /** Source-prefixed: "fb:…", "kj:…", "kr:…". */
  id: string;
  source: "facebook" | "kijiji" | "karrot";
  /** Which configured search found it. */
  search: string;
  title: string;
  /** As the seller wrote it: "$120", "Free", "$56 or trade". */
  price: string;
  place: string;
  image: string | null;
  url: string;
  /** Epoch ms the seller posted it, when the site says (Karrot does not). */
  postedAt: number | null;
  /** When the dashboard first saw it; stands in for `postedAt` when missing. */
  firstSeen: number;
}

export type PanelId = "fights" | "tech" | "traffic" | "transit" | "crime" | "events" | "printer" | "radar" | "market" | "ideas" | "sellers" | "leads" | "print3d";

export interface Scene {
  id: string;
  label: string;
  hotkey: string | null;
  channelId: string | null;
  playlistId: string | null;
  panels: PanelId[];
  density: "comfortable" | "compact";
  fontScale: number;
}

import type { Layout } from "./layout";
import type { LayoutPreset, PaneNode } from "./panes";

export interface AppConfig {
  /** The window tree — what is actually rendered. See lib/panes.ts. */
  layoutTree: PaneNode;
  /** What "Back to default" restores. The user sets this themselves. */
  layoutDefault: PaneNode;
  /** Named arrangements the user can jump back to. */
  layoutPresets: LayoutPreset[];
  /** The older two-column layout, kept only to migrate an existing config. */
  layout: Layout;
  place: { label: string; lat: number; lon: number };
  /** Where you live: picks the garbage collection calendar and marks the radar. */
  home: { label: string; lat: number; lon: number };
  /**
   * The City collection calendar ("Thursday2" and so on). Empty means look it
   * up from `home`, which is right unless the point sits on a boundary.
   */
  pickupCalendar: string;
  /** The print shop: what sells, where ideas come from. See sources/ebay.ts. */
  business: {
    /** eBay searches whose listings' sold counts are tracked day to day. */
    ebayQueries: string[];
  };
  /** New local listings worth knowing about. See sources/market.ts. */
  market: {
    enabled: boolean;
    sources: ("facebook" | "kijiji" | "karrot")[];
    /** Facebook gives no distance when logged out, so it is kept by city. */
    cities: string[];
    /** Kijiji and Karrot listings further than this from home are left out. */
    radiusKm: number;
    searches: {
      id: string;
      label: string;
      /** Typed into each site's search box. */
      queries: string[];
      /** A title must match this (case-insensitive regex) to count. */
      match: string;
      /** …and must not match this. */
      exclude?: string;
      /**
       * Keep only "looking for" posts instead of dropping them: people asking
       * for something, which for a print shop are customers.
       */
      wanted?: boolean;
    }[];
  };
  /** Cameras within this radius are offered by "cams near me". */
  camRadiusKm: number;
  channels: Channel[];
  playlists: CamPlaylist[];
  videoCams: VideoCam[];
  homeCams: HomeCam[];
  /** The live transit map. `bounds` is the data window; the view roams inside it. */
  map: {
    label: string;
    routes: string[];
    bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
    /** The fixed window the map shows. Never pans. */
    view: { latMin: number; latMax: number; lonMin: number; lonMax: number };
    /** OpenStreetMap route relations for the subway lines to draw. */
    subwayRelations: number[];
    /**
     * Stops whose next arrivals show in a strip under the map. `stop` is the
     * NextBus stop tag; `direction` keeps only trips whose dirTag starts with
     * it (a stop can be served both ways).
     */
    departures: { route: string; stop: string; direction?: string; label: string }[];
    showStops: boolean;
    showCameras: boolean;
    showIncidents: boolean;
  };
  scenes: Scene[];
  panels: PanelId[];
  panelDwellMs: number;
  camBandDwellMs: number;
  /** How long each live video camera holds before cycling to the next. */
  videoCamDwellMs: number;
  camRefreshMs: number;
  camFrameBuffer: number;
  /** Stations and streets worth spotting in a TTC alert. */
  transitPlaces: string[];
  transitStops: { id: string; label: string }[];
  routesOfInterest: string[]; // raise a breaking banner on full closure
  news: {
    weights: Record<string, number>;
    boost: string[];
    mute: string[];
    crimeKeywords: string[];
  };
  ticker: {
    mix: { headlines: number; traffic: number; custom: number };
    custom: string[];
    speed: number; // px per second
  };
  ui: {
    theme: "cp24" | "midnight" | "amber";
    accent: string;
    density: "comfortable" | "compact";
    fontScale: number;
    idleResumeMs: number;
    burnInProtection: boolean;
    nightModeFrom: string | null; // "23:00"
    nightModeTo: string | null; // "07:00"
    dndFrom: string | null;
    dndTo: string | null;
    chimeOnAlert: boolean;
  };
  power: {
    batterySaver: boolean; // slow polls when on battery
    dataSaver: boolean; // cap camera refresh + video quality
    dataSaverCamRefreshMs: number;
  };
  sourceIntervalOverrides: Record<string, number>;
  mutedWidgets: string[];
  manualFightCards: FightCard[];
  /** Local events: within `radiusKm` of `center`, plus anything featured. */
  events: { center: { lat: number; lon: number }; radiusKm: number };
  /**
   * A Bambu Lab printer on the local network, in LAN mode. The access code is
   * on the printer's screen (and in Bambu Studio); it never leaves the server.
   */
  printer: { label: string; host: string; serial: string; accessCode: string };
}
