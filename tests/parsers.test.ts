import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assemble, freshenCards, parseOneEvents, parsePflDate, parsePflEvents, parseUfcEvents, sameLocalDay,
} from "../src/lib/sources/fights";
import { parseOn511Cams, parseTorontoCams, distanceKm } from "../src/lib/sources/cams";
import { parseEvents, relevantEvents, breakingClosures, severityScore } from "../src/lib/sources/traffic";
import { alertWeight, parseAlerts } from "../src/lib/sources/transit";
import { highlightPlaces } from "../src/lib/places";
import { mergeVehicles, parseRouteConfig, updateVehicles, parseVehicles, withinBounds } from "../src/lib/sources/ttcmap";
import { parseFeed, titleFingerprint } from "../src/lib/rss";
import { cleanSummary, dedupe, isCrime, isFluff, isMuted, scoreItem } from "../src/lib/sources/news";
import { CARD_RUNTIME_MS, nextWetDay, rainChance, rainStartsInMinutes, routeChip, shortCamLabel } from "../src/lib/format";
import { feelsLike, nearestFeature, parseEnvCanada, parseForecasts, type ECProps } from "../src/lib/sources/weather";
import { embedUrl, parseChannelRef, watchUrl } from "../src/lib/channels";
import { isUnplayable, parsePlayerEvent, parsePlayerMessage, randomIndex, randomStartSeconds } from "../src/lib/player";
import { composeTicker } from "../src/components/Ticker";
import { FALLBACK_FIT, fitSixteenNine } from "../src/components/hooks";
import { DEFAULT_LAYOUT, normalizeLayout, slotStyle, usesSixteenNineSolve } from "../src/lib/layout";
import { livenessUrl, readLiveFlags } from "../src/lib/sources/livecams";
import { withCredentials } from "../src/lib/homecam";
import { mergeLines, parseSubway } from "../src/lib/sources/subway";
import {
  MAX_RATIO, MIN_RATIO, closeLeaf, defaultTree, flipSplit, leaf, leaves, movePane, normalizeTree,
  safeTree, setLeafLocked, setSplitRatio, split, splitLeaf, swapSplit, unusedSections,
} from "../src/lib/panes";
import type { FightCard, Item, TrafficEvent } from "../src/lib/types";

const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("UFC events listing", () => {
  const cards = parseUfcEvents(fixture("ufc-events.html"));

  it("finds events", () => {
    expect(cards.length).toBeGreaterThan(5);
  });

  it("reads the main-card timestamp rather than parsing display text", () => {
    const dated = cards.filter((c) => c.startsAt !== null);
    expect(dated.length).toBeGreaterThan(5);
    for (const c of dated) {
      expect(c.startsAt).toBeGreaterThan(Date.parse("2000-01-01"));
    }
  });

  it("captures name, link and location", () => {
    const c = cards[0];
    expect(c.name.length).toBeGreaterThan(0);
    expect(c.link).toMatch(/^https:\/\/www\.ufc\.com\/event\//);
    expect(c.promotion).toBe("UFC");
  });
});

describe("ONE events listing", () => {
  const cards = parseOneEvents(fixture("one-events.html"));

  it("finds events with timestamps and posters", () => {
    expect(cards.length).toBeGreaterThan(3);
    expect(cards.filter((c) => c.startsAt !== null).length).toBeGreaterThan(3);
    expect(cards.filter((c) => c.posterUrl).length).toBeGreaterThan(3);
  });
});

describe("PFL events listing", () => {
  const now = Date.parse("2026-09-09T12:00:00Z");
  const cards = parsePflEvents(fixture("pfl-events.html"), now);

  it("reads only the upcoming tab, not the full archive", () => {
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(40); // the page ships 286 event blocks
  });

  it("infers a year for the year-less date", () => {
    expect(parsePflDate("Fri, Oct 2", now)).toBe(Date.parse("Oct 2, 2026 18:00:00 GMT"));
    // A January date seen in September belongs to next year, not this one.
    expect(parsePflDate("Thu, Jan 15", now)).toBe(Date.parse("Jan 15, 2027 18:00:00 GMT"));
    expect(parsePflDate("not a date", now)).toBeNull();
  });
});

describe("fight card assembly", () => {
  const now = Date.parse("2026-09-09T12:00:00Z");
  const base = {
    promotion: "UFC" as const, name: "X", venue: "", location: "", posterUrl: null,
    link: "", fights: [], isToday: false, source: "scrape" as const,
  };

  it("drops events more than a day past and sorts soonest first", () => {
    const out = assemble(
      [
        { ...base, id: "old", startsAt: now - 5 * 86_400_000 },
        { ...base, id: "later", startsAt: now + 5 * 86_400_000 },
        { ...base, id: "soon", startsAt: now + 86_400_000 },
      ],
      [],
      now,
    );
    expect(out.map((c) => c.id)).toEqual(["soon", "later"]);
  });

  it("flags an event happening today", () => {
    const out = assemble([{ ...base, id: "t", startsAt: now + 3_600_000 }], [], now);
    expect(out[0].isToday).toBe(true);
  });

  it("lets a manual card override a scraped one of the same id", () => {
    const out = assemble(
      [{ ...base, id: "dup", name: "scraped", startsAt: now + 86_400_000 }],
      [{ ...base, id: "dup", name: "hand-entered", startsAt: now + 86_400_000, source: "manual" }],
      now,
    );
    expect(out[0].name).toBe("hand-entered");
    expect(out[0].source).toBe("manual");
  });

  it("keeps an event whose start time is unknown", () => {
    const out = assemble([{ ...base, id: "tbd", startsAt: null }], [], now);
    expect(out).toHaveLength(1);
  });
});

describe("sameLocalDay", () => {
  it("compares calendar days, not 24h windows", () => {
    const a = new Date(2026, 8, 9, 1, 0).getTime();
    const b = new Date(2026, 8, 9, 23, 0).getTime();
    expect(sameLocalDay(a, b)).toBe(true);
    expect(sameLocalDay(a, b + 3_600_000 * 2)).toBe(false);
  });
});

describe("camera parsers", () => {
  it("keys Toronto cams on the image number, not OBJECTID", () => {
    const cams = parseTorontoCams({
      features: [
        {
          attributes: {
            IMAGEURL: "http://opendata.toronto.ca/x/CameraImages/loc8001.jpg",
            MAINROAD: "YORK ST", CROSSROAD: "BREMNER BLVD",
          },
          geometry: { x: -79.38, y: 43.64 },
        },
      ],
    });
    expect(cams).toHaveLength(1);
    expect(cams[0].id).toBe("to:8001");
    expect(cams[0].label).toBe("YORK ST @ BREMNER BLVD");
    expect(cams[0].imageUrl.startsWith("https:")).toBe(true);
  });

  it("skips Toronto rows without a usable image url", () => {
    expect(parseTorontoCams({ features: [{ attributes: { IMAGEURL: "" } }] })).toHaveLength(0);
  });

  it("expands each enabled 511 view into its own camera and skips disabled ones", () => {
    const cams = parseOn511Cams([
      {
        Id: 1, Roadway: "QEW", Location: "QEW West of Thompson", Latitude: 42.9, Longitude: -78.9,
        Views: [
          { Id: 1, Url: "https://511on.ca/map/Cctv/1", Status: "Enabled", Description: "Toronto Bound" },
          { Id: 2, Url: "https://511on.ca/map/Cctv/2", Status: "Disabled" },
        ],
      },
    ]);
    expect(cams).toHaveLength(1);
    expect(cams[0].id).toBe("on511:1");
    expect(cams[0].label).toContain("Toronto Bound");
  });
});

describe("distanceKm", () => {
  it("measures a known short hop", () => {
    // Union Station to Yonge & Bloor is roughly 3km.
    const d = distanceKm(43.6455, -79.3807, 43.6709, -79.3866);
    expect(d).toBeGreaterThan(2.5);
    expect(d).toBeLessThan(3.5);
  });
});

describe("traffic", () => {
  // Toronto's road restrictions feed: numbers arrive as strings, and nearly
  // every description is prefixed with the control centre's own tag.
  const raw = [
    {
      id: "1", road: "Don Valley Pkwy", roadClass: "Expressway", type: "ROAD_CLOSED",
      subType: "ROAD_CLOSED_CONSTRUCTION", directionsAffected: "BOTH_DIRECTIONS",
      description: "Toronto-TMC: Closed due to a collision.",
      latitude: "43.7", longitude: "-79.4", lastUpdated: "1775155380000",
    },
    {
      id: "2", road: "Kingston Rd", roadClass: "Local Road", type: "CONSTRUCTION",
      directionsAffected: "ONE_DIRECTION", description: "Sidewalk repair far away",
      latitude: "46.5", longitude: "-84.3", lastUpdated: "1775155380000",
    },
    {
      id: "3", road: "Expired St", roadClass: "Local Road", type: "CONSTRUCTION",
      description: "Gone", latitude: "43.7", longitude: "-79.4",
      lastUpdated: "1775155380000", expired: 1,
    },
  ];

  it("reads the City's string fields and drops expired rows", () => {
    const out = parseEvents(raw);
    expect(out.map((e) => e.id)).toEqual(["1", "2"]);
    expect(out[0].updated).toBe(1775155380000);
    expect(out[0].lat).toBeCloseTo(43.7);
  });

  it("strips the control centre prefix that every row carries", () => {
    expect(parseEvents(raw)[0].description).toBe("Closed due to a collision.");
  });

  it("treats a closed expressway as major and a local dig as minor", () => {
    const [a, b] = parseEvents(raw);
    expect(a.severity).toBe("Major");
    expect(a.isFullClosure).toBe(true);
    expect(b.isFullClosure).toBe(false);
    expect(severityScore(a)).toBeGreaterThan(severityScore(b));
  });

  it("keeps events on a named route and drops distant unrelated ones", () => {
    const out = relevantEvents(parseEvents(raw), 43.65, -79.38, 25, ["Don Valley"]);
    expect(out.map((e) => e.id)).toEqual(["1"]);
  });

  it("raises only full closures on named routes as breaking", () => {
    expect(breakingClosures(parseEvents(raw), ["Don Valley"]).map((e) => e.id)).toEqual(["1"]);
    expect(breakingClosures(parseEvents(raw), ["Gardiner"])).toHaveLength(0);
  });
});

describe("TTC alerts", () => {
  const resp = {
    routes: [
      { id: "1", route: "1", routeType: "Subway", alertType: "Planned",
        activePeriodGroup: ["Current"], title: "No subway service between St Clair and College." },
      { id: "2", route: "504", routeType: "Streetcar", alertType: "Unplanned",
        activePeriodGroup: ["Current"], title: "No service on King due to a collision." },
      { id: "3", route: "37", routeType: "Bus", alertType: "Planned",
        activePeriodGroup: ["Weekend"], title: "Buses not stopping on Rexdale." },
      // The feed repeats a disruption once per affected branch.
      { id: "4", route: "1", routeType: "Subway", alertType: "Planned",
        activePeriodGroup: ["Current"], title: "No subway service between St Clair and College." },
      { id: "5", route: "9", routeType: "Bus", title: "" },
    ],
  };

  it("puts an unplanned disruption above planned work", () => {
    const out = parseAlerts(resp);
    expect(out[0].route).toBe("504");
    expect(out[0].planned).toBe(false);
  });

  it("collapses the same alert repeated across branches", () => {
    expect(parseAlerts(resp).filter((a) => a.route === "1")).toHaveLength(1);
  });

  it("skips entries with no text", () => {
    expect(parseAlerts(resp).some((a) => a.route === "9")).toBe(false);
  });

  it("ranks subway above streetcar above bus, all else equal", () => {
    const w = (routeType: string) => alertWeight({ routeType, alertType: "Planned", activePeriodGroup: ["Current"] });
    expect(w("Subway")).toBeGreaterThan(w("Streetcar"));
    expect(w("Streetcar")).toBeGreaterThan(w("Bus"));
  });

  it("ranks current above future", () => {
    const cur = alertWeight({ routeType: "Bus", alertType: "Planned", activePeriodGroup: ["Current"] });
    const later = alertWeight({ routeType: "Bus", alertType: "Planned", activePeriodGroup: ["Weekend"] });
    expect(cur).toBeGreaterThan(later);
  });

  it("survives an empty response", () => {
    expect(parseAlerts({})).toEqual([]);
  });
});


describe("feed parsing", () => {
  it("reads RSS items", () => {
    const out = parseFeed(`<rss><channel>
      <item><title>Hello &amp; goodbye</title><link>https://e.com/1</link>
      <description><![CDATA[<p>Body text</p>]]></description>
      <pubDate>Tue, 09 Sep 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Hello & goodbye");
    expect(out[0].summary).toBe("Body text");
    expect(out[0].published).toBe(Date.parse("Tue, 09 Sep 2026 10:00:00 GMT"));
  });

  it("reads Atom entries and their href links", () => {
    const out = parseFeed(`<feed><entry><title>Atom post</title>
      <link rel="alternate" href="https://e.com/a"/>
      <summary>Sum</summary><updated>2026-09-09T10:00:00Z</updated></entry></feed>`);
    expect(out[0].link).toBe("https://e.com/a");
  });

  it("returns nothing rather than throwing on junk", () => {
    expect(parseFeed("<not xml")).toEqual([]);
    expect(parseFeed("")).toEqual([]);
  });
});

describe("news ranking", () => {
  it("detects crime keywords case-insensitively", () => {
    expect(isCrime("Police investigate SHOOTING", ["shooting"])).toBe(true);
    expect(isCrime("New park opens", ["shooting"])).toBe(false);
  });

  it("mutes on substring match", () => {
    expect(isMuted("A story about crypto", "", ["crypto"])).toBe(true);
    expect(isMuted("A story", "", [])).toBe(false);
  });

  it("decays with age and doubles on a boost hit", () => {
    const now = Date.parse("2026-09-09T12:00:00Z");
    const fresh = scoreItem("t", "", now, 1, [], now);
    const old = scoreItem("t", "", now - 12 * 3_600_000, 1, [], now);
    expect(fresh).toBeGreaterThan(old);
    expect(scoreItem("rust news", "", now, 1, ["rust"], now)).toBeCloseTo(fresh * 2, 5);
  });
});

describe("dedupe", () => {
  const mk = (id: string, title: string, weight: number): Item => ({
    id, kind: "tech", sourceId: "s", title, body: "", link: `https://e.com/${id}`,
    published: 0, fetched: 0, weight, meta: {},
  });

  it("keeps the highest-weighted version of the same story", () => {
    const out = dedupe([
      mk("a", "Apple announces new laptop today", 1),
      mk("b", "Apple announces a new laptop", 3),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("b");
  });

  it("keeps genuinely different stories", () => {
    const out = dedupe([mk("a", "Apple ships laptop", 1), mk("b", "Toronto opens subway line", 1)]);
    expect(out).toHaveLength(2);
  });

  it("ignores stopwords when fingerprinting", () => {
    expect(titleFingerprint("The fire at the tower")).toBe(titleFingerprint("Fire at a tower"));
  });
});

describe("rain nowcast", () => {
  const now = Date.parse("2026-09-09T12:00:00Z");

  it("reports minutes until the first wet bucket", () => {
    const mins = rainStartsInMinutes(
      [{ at: now, mm: 0 }, { at: now + 900_000, mm: 0.4 }],
      now,
    );
    expect(mins).toBe(15);
  });

  it("returns null in a dry window", () => {
    expect(rainStartsInMinutes([{ at: now, mm: 0 }], now)).toBeNull();
  });
});

describe("Environment Canada weather", () => {
  const raw = JSON.parse(fixture("ec-weather.json")) as {
    features: { properties: ECProps; geometry?: { coordinates?: [number, number] } }[];
  };

  it("picks the nearest station, not the first in the bbox", () => {
    const f = nearestFeature(raw.features, 43.6532, -79.3832);
    expect(String((f?.properties.name as { en: string }).en)).toBe("Toronto");
  });

  it("reads current conditions", () => {
    const w = parseEnvCanada(raw.features[0].properties);
    expect(w.tempC).not.toBeNull();
    expect(w.condition.length).toBeGreaterThan(0);
  });

  it("reads sunrise and sunset", () => {
    const w = parseEnvCanada(raw.features[0].properties);
    expect(w.sunrise).toBeGreaterThan(0);
    expect(w.sunset).toBeGreaterThan(w.sunrise as number);
  });

  it("fills the hourly strip", () => {
    const w = parseEnvCanada(raw.features[0].properties);
    expect(w.hourly.length).toBe(12);
    expect(w.hourly[0].at).toBeGreaterThan(0);
  });

  it("folds day and night entries into one row per day", () => {
    const w = parseEnvCanada(raw.features[0].properties);
    expect(w.daily.length).toBeGreaterThan(2);
    // A real daytime row carries both a high and the night's low.
    const withBoth = w.daily.filter((d) => d.hiC !== null && d.loC !== null);
    expect(withBoth.length).toBeGreaterThan(1);
    for (const d of withBoth) expect(d.hiC as number).toBeGreaterThanOrEqual(d.loC as number);
  });

  it("keeps Tonight as its own low-only row", () => {
    const rows = parseForecasts([
      {
        period: { textForecastName: { en: "Tonight" } },
        temperatures: { temperature: [{ class: { en: "low" }, value: { en: 19 } }] },
        abbreviatedForecast: { textSummary: { en: "Cloudy" } },
      },
      {
        period: { textForecastName: { en: "Wednesday" } },
        temperatures: { temperature: [{ class: { en: "high" }, value: { en: 26 } }] },
        abbreviatedForecast: { textSummary: { en: "Showers" } },
      },
      {
        period: { textForecastName: { en: "Wednesday night" } },
        temperatures: { temperature: [{ class: { en: "low" }, value: { en: 18 } }] },
        abbreviatedForecast: { textSummary: { en: "A few showers" } },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ day: "Tonight", hiC: null, loC: 19 });
    expect(rows[1]).toMatchObject({ day: "Wednesday", hiC: 26, loC: 18, condition: "Showers" });
  });

  it("treats an empty warnings array as no alerts", () => {
    const w = parseEnvCanada({ warnings: [] });
    expect(w.warnings).toEqual([]);
  });

  it("survives a response with nothing in it", () => {
    const w = parseEnvCanada({});
    expect(w.daily).toEqual([]);
    expect(w.hourly).toEqual([]);
    expect(w.tempC).toBeNull();
  });
});

describe("feels-like guard", () => {
  it("ignores a stale windChill reported on a warm day", () => {
    // Exactly what Environment Canada returned for Toronto on 2026-09-09.
    expect(feelsLike(20.9, null, -3)).toBeNull();
  });

  it("uses humidex only when it is warm", () => {
    expect(feelsLike(28, 34, null)).toBe(34);
    expect(feelsLike(12, 34, null)).toBeNull();
  });

  it("uses windChill only when it is freezing", () => {
    expect(feelsLike(-8, null, -15)).toBe(-15);
    expect(feelsLike(5, null, -15)).toBeNull();
  });

  it("has no opinion without a temperature", () => {
    expect(feelsLike(null, 30, -30)).toBeNull();
  });
});

describe("Environment Canada value unwrapping", () => {
  // Stations disagree on nesting for the same field, and a missed unwrap used
  // to render "[object Object]" on screen.
  it("reads a flat {en} leaf", () => {
    const w = parseEnvCanada({ currentConditions: { wind: { direction: { en: "SSW" } } } });
    expect(w.windDir).toBe("SSW");
  });

  it("reads a nested {value:{en}} leaf", () => {
    const w = parseEnvCanada({
      currentConditions: { wind: { direction: { qaValue: { en: 100 }, value: { en: "S" } } } },
    });
    expect(w.windDir).toBe("S");
  });

  it("never stringifies an unrecognised object", () => {
    const w = parseEnvCanada({
      currentConditions: { wind: { direction: { weird: { nested: 1 } } }, condition: { odd: 1 } },
    });
    expect(w.windDir).toBeNull();
    expect(w.condition).toBe("");
  });

  it("still reads numbers through both shapes", () => {
    expect(parseEnvCanada({ currentConditions: { temperature: { en: 12 } } }).tempC).toBe(12);
    expect(parseEnvCanada({ currentConditions: { temperature: { value: { en: 12 } } } }).tempC).toBe(12);
  });
});

describe("channel refs", () => {
  const ch = (ref: string) => ({ id: "x", label: "X", type: "youtube" as const, ref });

  it("reads a watch URL", () => {
    const p = parseChannelRef("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(p).toMatchObject({ ref: "dQw4w9WgXcQ", embeddable: true });
    expect(embedUrl(ch("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))).toContain("/embed/dQw4w9WgXcQ");
  });

  it("reads a playlist URL and a bare playlist id", () => {
    expect(parseChannelRef("https://www.youtube.com/playlist?list=PLabc123").ref).toBe("PLabc123");
    expect(embedUrl(ch("PLabc123"))).toContain("videoseries?list=PLabc123");
  });

  it("loops a single video by naming it as its own playlist", () => {
    // `loop=1` on its own is ignored for a single video.
    const url = embedUrl(ch("dQw4w9WgXcQ")) ?? "";
    expect(url).toContain("loop=1");
    expect(url).toContain("playlist=dQw4w9WgXcQ");
  });

  it("hides YouTube's own controls and opens the API for the volume control", () => {
    const url = embedUrl(ch("dQw4w9WgXcQ")) ?? "";
    expect(url).toContain("controls=0");
    expect(url).toContain("enablejsapi=1");
  });

  it("reads youtu.be short links", () => {
    expect(parseChannelRef("https://youtu.be/abc12345678").ref).toBe("abc12345678");
  });

  it("turns a channel id into its uploads playlist", () => {
    // UC… has no direct embed; UU… is the same channel's uploads.
    expect(embedUrl(ch("UCabcdefghijklmnopqrstu"))).toContain("list=UUabcdefghijklmnopqrstu");
  });

  it("treats a channel /live URL as a live embed", () => {
    const p = parseChannelRef("https://www.youtube.com/channel/UCabcdefghijklmnopqrstu/live");
    expect(p.type).toBe("youtube-live");
    expect(p.embeddable).toBe(true);
  });

  it("marks an @handle as not embeddable rather than rendering a black box", () => {
    const p = parseChannelRef("https://www.youtube.com/@SomeChannel");
    expect(p.embeddable).toBe(false);
    expect(embedUrl(ch("https://www.youtube.com/@SomeChannel"))).toBeNull();
    expect(watchUrl(ch("@SomeChannel"))).toBe("https://www.youtube.com/@SomeChannel");
  });

  it("plays a direct stream URL", () => {
    expect(parseChannelRef("https://example.com/live.m3u8")).toMatchObject({ type: "hls", embeddable: true });
  });

  it("treats an empty ref as unconfigured", () => {
    expect(parseChannelRef("")).toMatchObject({ ref: "", embeddable: false });
    expect(embedUrl(ch(""))).toBeNull();
  });
});

describe("camera label disambiguation", () => {
  it("appends the camera number only when labels collide", () => {
    const cams = parseTorontoCams({
      features: [
        { attributes: { IMAGEURL: "https://x/CameraImages/loc8001.jpg", MAINROAD: "BAY ST", CROSSROAD: "QUEEN ST W" }, geometry: { x: -79.38, y: 43.65 } },
        { attributes: { IMAGEURL: "https://x/CameraImages/loc8002.jpg", MAINROAD: "BAY ST", CROSSROAD: "QUEEN ST W" }, geometry: { x: -79.38, y: 43.65 } },
        { attributes: { IMAGEURL: "https://x/CameraImages/loc8003.jpg", MAINROAD: "KING ST", CROSSROAD: "JOHN ST" }, geometry: { x: -79.39, y: 43.64 } },
      ],
    });
    expect(cams.map((c) => c.label)).toEqual([
      "BAY ST @ QUEEN ST W #8001",
      "BAY ST @ QUEEN ST W #8002",
      "KING ST @ JOHN ST",
    ]);
  });
});

describe("ticker composition", () => {
  const item = (id: string, title: string): Item => ({
    id, kind: "tech", sourceId: "s", title, body: "", link: "",
    published: 0, fetched: 0, weight: 1,
    meta: { source: "Techmeme" },
  });
  const closure = (id: string): TrafficEvent => ({
    id, roadway: "DVP", direction: "NB", description: "Lane closed", isFullClosure: false,
  } as TrafficEvent);

  it("tags headlines with their outlet", () => {
    const out = composeTicker([item("n1", "News one")], [], [], { headlines: 1, traffic: 0, custom: 0 }, 4);
    expect(out[0].tone).toBe("news");
    expect(out[0].tag).toBe("Techmeme");
  });

  it("interleaves streams instead of concatenating them", () => {
    const news = [item("n1", "News one"), item("n2", "News two")];
    const out = composeTicker(news, [closure("t1")], ["mine"], { headlines: 2, traffic: 1, custom: 1 }, 4);
    const tones = out.map((e) => e.tone);
    // Headlines must not all run before the first closure.
    expect(tones.indexOf("traffic")).toBeLessThan(tones.lastIndexOf("news"));
  });

  it("omits a stream weighted to zero", () => {
    const out = composeTicker([item("n1", "News")], [closure("t1")], [], { headlines: 0, traffic: 1, custom: 0 }, 6);
    expect(out.every((e) => e.tone !== "news")).toBe(true);
  });
});

describe("16:9 pane fitting", () => {
  const base = { chrome: 30, gap: 4, minRight: 300, minBottom: 150 };
  const px = (t: string) => Number(t.split("px")[0]);

  /** Video height is the pane height minus the pane's own header. */
  const ratioOf = (f: { gridTemplateColumns: string; paneHeight: number | null }) =>
    px(f.gridTemplateColumns) / ((f.paneHeight as number) - base.chrome);

  it("makes the video area 16:9 on a 1280x720 container", () => {
    expect(ratioOf(fitSixteenNine({ ...base, width: 1272, height: 600 }))).toBeCloseTo(16 / 9, 1);
  });

  it("stays 16:9 on a wide container", () => {
    expect(ratioOf(fitSixteenNine({ ...base, width: 2560, height: 1200 }))).toBeCloseTo(16 / 9, 1);
  });

  it("switches to width-limited when height alone would overflow", () => {
    const fit = fitSixteenNine({ ...base, width: 900, height: 1400 });
    expect(ratioOf(fit)).toBeCloseTo(16 / 9, 1);
    expect(px(fit.gridTemplateColumns)).toBeLessThanOrEqual(900 - base.gap - base.minRight);
  });

  it("always leaves the reserved space for the other panels", () => {
    for (const [w, h] of [[1272, 600], [1600, 800], [2560, 1200], [1024, 500]]) {
      const fit = fitSixteenNine({ ...base, width: w, height: h });
      expect(px(fit.gridTemplateColumns)).toBeLessThanOrEqual(w - base.gap - base.minRight);
      expect(fit.paneHeight as number).toBeLessThanOrEqual(h - base.gap - base.minBottom);
    }
  });

  it("falls back rather than collapsing when the container has no size", () => {
    expect(fitSixteenNine({ ...base, width: 0, height: 0 })).toEqual(FALLBACK_FIT);
    expect(fitSixteenNine({ ...base, width: 200, height: 100 })).toEqual(FALLBACK_FIT);
  });

  it("fixes only the pane height, leaving the right column free to split on its own", () => {
    const fit = fitSixteenNine({ ...base, width: 1272, height: 600 });
    expect(fit.paneHeight).toBeGreaterThan(0);
    expect(fit.gridTemplateColumns).toContain("minmax(0, 1fr)");
    // No row template: the two columns must not be forced into aligned rows.
    expect(Object.keys(fit)).not.toContain("gridTemplateRows");
  });
});

describe("rain outlook", () => {
  it("prefers a real probability when Environment Canada supplies one", () => {
    expect(rainChance({ pop: 60, condition: "Cloudy" })).toBe(60);
  });

  it("falls back to the condition text, which EC always provides", () => {
    // `pop` came back undefined for every day in the live response.
    expect(rainChance({ pop: null, condition: "Showers" })).toBe(90);
    expect(rainChance({ pop: null, condition: "Chance of showers" })).toBe(40);
    expect(rainChance({ pop: null, condition: "Periods of rain" })).toBe(70);
    expect(rainChance({ pop: null, condition: "Sunny" })).toBeNull();
    expect(rainChance({ pop: null, condition: "" })).toBeNull();
  });

  it("finds the next day worth warning about", () => {
    const wet = nextWetDay([
      { day: "Tonight", pop: null, condition: "Clear" },
      { day: "Wednesday", pop: null, condition: "Chance of showers" },
      { day: "Thursday", pop: null, condition: "Showers" },
    ]);
    expect(wet).toMatchObject({ day: "Wednesday", chance: 40 });
  });

  it("says nothing when the whole forecast is dry", () => {
    expect(nextWetDay([{ day: "Wed", pop: null, condition: "Sunny" }])).toBeNull();
  });
});

describe("TTC map", () => {
  it("reads route geometry, colour and stops", () => {
    const shape = parseRouteConfig({
      route: {
        tag: "87", title: "87-Cosburn", color: "cc6600",
        path: [{ point: [{ lat: "43.69", lon: "-79.32" }, { lat: "43.70", lon: "-79.31" }] }],
        stop: [{ lat: "43.69", lon: "-79.32", title: "Cosburn at Pape" }],
      },
    });
    expect(shape?.tag).toBe("87");
    // TTC ships a bare hex; CSS needs the hash.
    expect(shape?.color).toBe("#cc6600");
    expect(shape?.paths[0]).toEqual([[-79.32, 43.69], [-79.31, 43.7]]);
    expect(shape?.stops).toHaveLength(1);
  });

  it("drops single-point path segments that cannot be drawn", () => {
    const shape = parseRouteConfig({
      route: { tag: "1", path: [{ point: [{ lat: "43.6", lon: "-79.3" }] }] },
    });
    expect(shape?.paths).toEqual([]);
  });

  it("handles a route with one path segment returned as an object", () => {
    const shape = parseRouteConfig({
      route: { tag: "2", path: { point: [{ lat: "43.6", lon: "-79.3" }, { lat: "43.61", lon: "-79.31" }] } },
    });
    expect(shape?.paths).toHaveLength(1);
  });

  it("returns null without a route tag", () => {
    expect(parseRouteConfig({})).toBeNull();
  });

  it("parses live vehicles and drops stale reports", () => {
    const out = parseVehicles({
      vehicle: [
        { id: "8496", routeTag: "87", lat: "43.689", lon: "-79.348", heading: "94", speedKmHr: "0", secsSinceReport: "12" },
        // Five minutes without a report means the position is fiction.
        { id: "old", routeTag: "87", lat: "43.7", lon: "-79.3", secsSinceReport: "600" },
        { id: "bad", routeTag: "87", lat: "nope", lon: "-79.3", secsSinceReport: "5" },
      ],
    });
    expect(out.map((v) => v.id)).toEqual(["8496"]);
    expect(out[0]).toMatchObject({ route: "87", heading: 94, age: 12 });
  });

  it("keeps only what is inside the map window", () => {
    const b = { latMin: 43.668, latMax: 43.732, lonMin: -79.382, lonMax: -79.276 };
    expect(withinBounds({ lat: 43.7, lon: -79.31 }, b)).toBe(true);
    expect(withinBounds({ lat: 43.65, lon: -79.38 }, b)).toBe(false);
  });
});

describe("layout sections", () => {
  it("keeps a valid layout as written", () => {
    const out = normalizeLayout({
      left: [{ ids: ["video"], flex: 0 }, { ids: ["panels"], flex: 1 }],
      right: [{ ids: ["weather"], flex: 0 }, { ids: ["map", "cameras"], flex: 2 }],
    });
    expect(out.left.map((s) => s.ids)).toEqual([["video"], ["panels"]]);
    expect(out.right.map((s) => s.ids)).toEqual([["weather"], ["map", "cameras"]]);
  });

  it("accepts the older single-id slot shape", () => {
    const out = normalizeLayout({ left: [{ id: "video", flex: 0 }], right: [{ id: "map", flex: 1 }] });
    expect(out.left[0].ids).toEqual(["video"]);
    expect(out.right[0].ids).toEqual(["map"]);
  });

  it("caps a row at two sections so neither becomes unreadable", () => {
    const out = normalizeLayout({ left: [{ ids: ["map", "cameras", "weather"], flex: 1 }], right: [] });
    expect(out.left[0].ids).toEqual(["map", "cameras"]);
    // The overflow is dropped, not silently moved somewhere else.
    expect(out.right).toEqual([]);
  });

  it("drops unknown sections rather than rendering nothing", () => {
    const out = normalizeLayout({ left: [{ ids: ["video"] }, { ids: ["nonsense"] }], right: [] });
    expect(out.left.map((s) => s.ids)).toEqual([["video"]]);
  });

  it("refuses to place the same section twice", () => {
    const out = normalizeLayout({
      left: [{ ids: ["map"], flex: 1 }],
      right: [{ ids: ["map"], flex: 1 }, { ids: ["cameras"], flex: 1 }],
    });
    expect(out.left.map((s) => s.ids)).toEqual([["map"]]);
    expect(out.right.map((s) => s.ids)).toEqual([["cameras"]]);
  });

  it("falls back to the default when a hand-edited layout is empty", () => {
    // A blank screen is never an acceptable outcome of editing a config file.
    expect(normalizeLayout({ left: [], right: [] })).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout({ left: [{ ids: ["bogus"] }] })).toEqual(DEFAULT_LAYOUT);
  });

  it("promotes the right column when the left is empty", () => {
    const out = normalizeLayout({ left: [], right: [{ ids: ["map"], flex: 1 }] });
    expect(out.left.map((s) => s.ids)).toEqual([["map"]]);
    expect(out.right).toEqual([]);
  });

  it("clamps nonsense flex values", () => {
    const out = normalizeLayout({ left: [{ ids: ["map"], flex: -5 }, { ids: ["cameras"], flex: 999 }], right: [] });
    expect(out.left[0].flex).toBe(0);
    expect(out.left[1].flex).toBe(6);
  });

  it("defaults a missing flex to a share rather than to content-size", () => {
    expect(normalizeLayout({ left: [{ ids: ["map"] }], right: [] }).left[0].flex).toBe(1);
  });

  it("only applies the 16:9 solve when video leads the left column", () => {
    expect(usesSixteenNineSolve(DEFAULT_LAYOUT)).toBe(true);
    expect(usesSixteenNineSolve({ left: [{ ids: ["map"], flex: 1 }], right: [] })).toBe(false);
  });

  it("gives a content-sized slot auto height and a shared slot a flex basis", () => {
    expect(slotStyle({ ids: ["weather"], flex: 0 }).flex).toBe("0 0 auto");
    expect(slotStyle({ ids: ["map"], flex: 1.35 }).flex).toBe("1.35 1 0");
  });
});



describe("live cam liveness", () => {
  it("reads the live and embeddable flags from a watch page", () => {
    expect(readLiveFlags('..."isLive":true...')).toEqual({ live: true, embeddable: true });
    expect(readLiveFlags('..."isLive":false...')).toEqual({ live: false, embeddable: true });
    expect(readLiveFlags('..."isLive":true..."playableInEmbed":false...')).toEqual({
      live: true, embeddable: false,
    });
  });

  it("treats a page with no flag as not live", () => {
    // An ended stream becomes an archive, which has no isLive marker.
    expect(readLiveFlags("<html>nothing here</html>").live).toBe(false);
  });
});

describe("TTC alert place highlighting", () => {
  const places = ["Broadview", "Danforth", "Coxwell", "Main Street", "O'Connor"];

  it("picks the station out of a long sentence", () => {
    const parts = highlightPlaces("No service between Broadview and Coxwell stations.", places);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["Broadview", "Coxwell"]);
    // The original text survives intact.
    expect(parts.map((p) => p.text).join("")).toBe("No service between Broadview and Coxwell stations.");
  });

  it("returns one plain part when nothing local is named", () => {
    expect(highlightPlaces("Diversion at Keele and Dundas.", places)).toEqual([
      { text: "Diversion at Keele and Dundas.", hit: false },
    ]);
  });

  it("matches whole words only", () => {
    // "Main Street" must not light up inside "Mainstreet".
    expect(highlightPlaces("Mainstreeting is not a word.", places).some((p) => p.hit)).toBe(false);
  });

  it("merges an overlapping match into one span", () => {
    const parts = highlightPlaces("Broadview Station is closed.", ["Broadview", "Broadview Station"]);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["Broadview Station"]);
  });

  it("is case-insensitive but preserves the original casing", () => {
    const parts = highlightPlaces("Delays on DANFORTH Ave.", places);
    expect(parts.find((p) => p.hit)?.text).toBe("DANFORTH");
  });

  it("lifts an alert naming somewhere you travel above one that does not", () => {
    const local = alertWeight({ routeType: "Bus", alertType: "Planned", title: "Diversion at Coxwell." }, places);
    const far = alertWeight({ routeType: "Subway", alertType: "Planned", title: "Diversion at Keele." }, places);
    expect(local).toBeGreaterThan(far);
  });
});

describe("TTC alerts flag local ones", () => {
  const places = ["Broadview", "Coxwell", "Main Street"];
  const resp = {
    routes: [
      { id: "a", route: "2", routeType: "Subway", alertType: "Planned", activePeriodGroup: ["Current"],
        title: "No subway service between St George and Broadview stations." },
      { id: "b", route: "1", routeType: "Subway", alertType: "Planned", activePeriodGroup: ["Current"],
        title: "Trains move slower northbound from Davisville to Lawrence." },
    ],
  };

  it("marks the alert that names somewhere you travel", () => {
    const out = parseAlerts(resp, places);
    const broadview = out.find((a) => a.title.includes("Broadview"));
    const davisville = out.find((a) => a.title.includes("Davisville"));
    expect(broadview?.local).toBe(true);
    expect(davisville?.local).toBe(false);
  });

  it("sorts the local alert first even against an equal one", () => {
    expect(parseAlerts(resp, places)[0].title).toContain("Broadview");
  });

  it("flags nothing when no places are configured", () => {
    expect(parseAlerts(resp, []).every((a) => a.local === false)).toBe(true);
  });
});

describe("camera label shortening", () => {
  it("drops street types, which carry no information on a thumbnail", () => {
    expect(shortCamLabel("DANFORTH AVE @ BROADVIEW AVE")).toBe("DANFORTH @ BROADVIEW");
    expect(shortCamLabel("GERRARD ST E @ WOODBINE AVE")).toBe("GERRARD E @ WOODBINE");
    expect(shortCamLabel("DON MILLS RD @ O CONNOR DR")).toBe("DON MILLS @ O CONNOR");
  });

  it("drops the disambiguating suffix, which stays in the tooltip", () => {
    expect(shortCamLabel("DANFORTH AVE @ BROADVIEW AVE #8215")).toBe("DANFORTH @ BROADVIEW");
  });

  it("keeps a leading ST, which means Saint, not Street", () => {
    // Dropping it blindly would turn "ST CLAIR AVE E" into "CLAIR E".
    expect(shortCamLabel("O CONNOR DR @ ST CLAIR AVE E")).toBe("O CONNOR @ ST CLAIR E");
  });

  it("leaves a name with nothing to trim alone", () => {
    expect(shortCamLabel("QEW at Welland River Bridge")).toBe("QEW at Welland River Bridge");
  });
});

describe("incremental vehicle merge", () => {
  const now = Date.parse("2026-09-09T14:00:00Z");
  const bus = (id: string, lat: number, age: number) => ({
    id, route: "87", lat, lon: -79.31, heading: 90, speedKmH: 20, age, dir: "",
  });

  it("keeps buses that were not in the delta", () => {
    // TTC batches, so most polls return nothing at all.
    const out = mergeVehicles([bus("a", 43.70, 10)], [], now);
    expect(out.map((v) => v.id)).toEqual(["a"]);
  });

  it("replaces a position when the bus reports again", () => {
    const out = mergeVehicles([bus("a", 43.70, 60)], [bus("a", 43.71, 5)], now);
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBe(43.71);
    expect(out[0].age).toBe(5);
  });

  it("adds buses seen for the first time", () => {
    const out = mergeVehicles([bus("a", 43.70, 5)], [bus("b", 43.72, 5)], now);
    expect(out.map((v) => v.id).sort()).toEqual(["a", "b"]);
  });

  it("ages a bus that stops reporting, then drops it", () => {
    // A bus that went quiet is not still sitting where it was last seen.
    const first = mergeVehicles([], [bus("a", 43.70, 0)], now);
    const later = mergeVehicles(first, [], now + 120_000);
    expect(later[0].age).toBe(120);
    const muchLater = mergeVehicles(later, [], now + 400_000);
    expect(muchLater).toEqual([]);
  });

  it("does not let age drift across repeated empty merges", () => {
    const first = mergeVehicles([], [bus("a", 43.70, 10)], now);
    let acc = first;
    for (let i = 1; i <= 4; i++) acc = mergeVehicles(acc, [], now + i * 10_000);
    // 10s reported age plus 40s of silence.
    expect(acc[0].age).toBe(50);
  });

  it("lets a bus that drives out of the map leave instead of freezing at the edge", () => {
    const inMap = (v: { lat: number }) => v.lat < 43.75;
    const first = updateVehicles([], [bus("a", 43.74, 0)], now, inMap);
    expect(first).toHaveLength(1);
    const after = updateVehicles(first, [bus("a", 43.76, 0)], now + 10_000, inMap);
    expect(after).toEqual([]);
  });

  it("drops a bus switched to a route the map does not follow", () => {
    const only87 = (v: { route: string }) => v.route === "87";
    const first = updateVehicles([], [bus("a", 43.70, 0)], now, only87);
    const after = updateVehicles(first, [{ ...bus("a", 43.70, 0), route: "100" }], now + 10_000, only87);
    expect(after).toEqual([]);
  });

  it("drops a quiet bus after two and a half minutes", () => {
    const keep = () => true;
    const first = updateVehicles([], [bus("a", 43.70, 0)], now, keep);
    expect(updateVehicles(first, [], now + 140_000, keep)).toHaveLength(1);
    expect(updateVehicles(first, [], now + 160_000, keep)).toEqual([]);
  });
});

describe("home camera credentials", () => {
  it("moves user:pass out of the URL into a Basic header", () => {
    // fetch() ignores credentials embedded in a URL, and cameras hand you
    // exactly that form.
    const out = withCredentials("http://admin:hunter2@192.168.1.50/snapshot.jpg");
    expect(out.url).toBe("http://192.168.1.50/snapshot.jpg");
    expect(out.headers.authorization).toBe(`Basic ${Buffer.from("admin:hunter2").toString("base64")}`);
  });

  it("leaves a URL without credentials untouched", () => {
    const out = withCredentials("http://192.168.1.50/snapshot.jpg");
    expect(out.url).toBe("http://192.168.1.50/snapshot.jpg");
    expect(out.headers).toEqual({});
  });

  it("decodes percent-encoded credentials", () => {
    const out = withCredentials("http://admin:p%40ss@cam.local/img");
    expect(out.headers.authorization).toBe(`Basic ${Buffer.from("admin:p@ss").toString("base64")}`);
  });

  it("passes a malformed URL through rather than throwing", () => {
    expect(withCredentials("not a url")).toEqual({ url: "not a url", headers: {} });
  });
});

describe("uneven layout rows", () => {
  it("keeps a ratio that covers every section in the row", () => {
    const out = normalizeLayout({ left: [{ ids: ["weather", "homecams"], flex: 0, ratio: [3, 1] }], right: [] });
    expect(out.left[0].ratio).toEqual([3, 1]);
  });

  it("ignores a ratio that does not match the row", () => {
    // A half-specified ratio would silently mis-size one side.
    const out = normalizeLayout({ left: [{ ids: ["weather", "homecams"], flex: 0, ratio: [3] }], right: [] });
    expect(out.left[0].ratio).toBeUndefined();
  });

  it("repairs nonsense ratio values", () => {
    const out = normalizeLayout({ left: [{ ids: ["weather", "homecams"], flex: 0, ratio: [0, 99] }], right: [] });
    expect(out.left[0].ratio).toEqual([1, 8]);
  });
});

describe("subway lines from OpenStreetMap", () => {
  const rel = (ref: string, name: string, colour?: string) => ({
    type: "relation",
    tags: (colour ? { ref, name, colour } : { ref, name }) as Record<string, string>,
    members: [
      { type: "way", geometry: [{ lat: 43.677, lon: -79.358 }, { lat: 43.678, lon: -79.35 }] },
      { type: "node", role: "stop", lat: 43.677, lon: -79.358, tags: { name: "Broadview" } },
      { type: "node", role: "station", lat: 43.678, lon: -79.35, tags: { name: "Chester" } },
    ],
  });

  it("reads geometry, stations and the official colour", () => {
    const [line] = parseSubway([rel("2", "Line 2 Bloor-Danforth (Kipling → Kennedy)", "#00923F")]);
    expect(line.ref).toBe("2");
    expect(line.colour).toBe("#00923F");
    expect(line.paths[0]).toEqual([[-79.358, 43.677], [-79.35, 43.678]]);
    expect(line.stations.map((s) => s.name)).toEqual(["Broadview", "Chester"]);
  });

  it("drops the direction suffix from the name", () => {
    const [line] = parseSubway([rel("2", "Line 2 Bloor-Danforth (Kipling → Kennedy)")]);
    expect(line.name).toBe("Line 2 Bloor-Danforth");
  });

  it("merges the two directions of one line into a single entry", () => {
    // OSM maps each line once per direction; a station must not be drawn twice.
    const out = parseSubway([
      rel("2", "Line 2 Bloor-Danforth (Kipling → Kennedy)"),
      rel("2", "Line 2 Bloor-Danforth (Kennedy → Kipling)"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].stations).toHaveLength(2);
    expect(out[0].paths).toHaveLength(2);
  });

  it("falls back to the official colour when the tag is missing", () => {
    expect(parseSubway([rel("1", "Line 1 Yonge-University")])[0].colour).toBe("#F8C300");
    expect(parseSubway([rel("2", "Line 2 Bloor-Danforth")])[0].colour).toBe("#00923F");
  });

  it("takes station names from the standalone nodes Overpass emits", () => {
    // `out geom;` strips member tags, so names only arrive this way.
    const [line] = parseSubway([
      { type: "relation", tags: { ref: "2", name: "Line 2" }, members: [] },
      { type: "node", lat: 43.677, lon: -79.358, tags: { name: "Broadview", public_transport: "stop_position" } },
      { type: "node", lat: 43.677, lon: -79.358, tags: { name: "Broadview", railway: "station" } },
      { type: "node", lat: 43.678, lon: -79.35, tags: { name: "Chester", railway: "station" } },
      { type: "node", lat: 43.679, lon: -79.34, tags: { name: "Not a stop", railway: "level_crossing" } },
    ]);
    expect(line.stations.map((s) => s.name)).toEqual(["Broadview", "Chester"]);
  });

  it("attaches each node to the relation that precedes it", () => {
    const out = parseSubway([
      { type: "relation", tags: { ref: "2", name: "Line 2" }, members: [] },
      { type: "node", lat: 43.677, lon: -79.358, tags: { name: "Broadview", railway: "station" } },
      { type: "relation", tags: { ref: "1", name: "Line 1" }, members: [] },
      { type: "node", lat: 43.671, lon: -79.386, tags: { name: "Bloor-Yonge", railway: "station" } },
    ]);
    const byRef = Object.fromEntries(out.map((l) => [l.ref, l.stations.map((s) => s.name)]));
    expect(byRef["2"]).toEqual(["Broadview"]);
    expect(byRef["1"]).toEqual(["Bloor-Yonge"]);
  });

  it("ignores a node that arrives before any relation", () => {
    expect(
      parseSubway([{ type: "node", lat: 43.677, lon: -79.358, tags: { name: "X", railway: "station" } }]),
    ).toEqual([]);
  });

  it("keeps a line a throttled run failed to refetch", () => {
    const line = (ref: string, stations: number) => ({
      ref, name: `Line ${ref}`, colour: "#fff",
      paths: [], stations: Array.from({ length: stations }, (_, i) => ({ name: `s${i}`, lat: 0, lon: 0 })),
    });
    const out = mergeLines([line("1", 38), line("2", 31)], [line("2", 31)]);
    expect(out.map((l) => l.ref)).toEqual(["1", "2"]);
  });

  it("ignores anything without a line reference", () => {
    expect(parseSubway([{ type: "relation", tags: { name: "no ref" }, members: [] }])).toEqual([]);
    expect(parseSubway([])).toEqual([]);
  });
});

describe("player messages and random starts", () => {
  it("reads an infoDelivery payload and ignores everything else", () => {
    expect(parsePlayerMessage(JSON.stringify({ event: "infoDelivery", info: { duration: 120 } })))
      .toEqual({ duration: 120 });
    expect(parsePlayerMessage(JSON.stringify({ event: "onReady", info: { duration: 1 } }))).toBeNull();
    expect(parsePlayerMessage("not json")).toBeNull();
    expect(parsePlayerMessage({ event: "infoDelivery" })).toBeNull();
  });

  it("reads an error whichever shape it arrives in", () => {
    // Some builds send the code as a bare number, others nest it in the info.
    expect(parsePlayerEvent(JSON.stringify({ event: "onError", info: 150 }))?.errorCode).toBe(150);
    expect(
      parsePlayerEvent(JSON.stringify({ event: "infoDelivery", info: { errorCode: 100 } }))?.errorCode,
    ).toBe(100);
    expect(parsePlayerEvent(JSON.stringify({ event: "infoDelivery", info: { duration: 9 } }))?.errorCode)
      .toBeUndefined();
    expect(parsePlayerEvent("nope")).toBeNull();
  });

  it("treats removed, private and embed-blocked videos as skippable", () => {
    expect([5, 100, 101, 150].every(isUnplayable)).toBe(true);
    expect(isUnplayable(2)).toBe(false);
    expect(isUnplayable(undefined)).toBe(false);
  });

  it("keeps a random start inside the first 80% and off short clips", () => {
    expect(randomStartSeconds(600, () => 0.5)).toBe(240);
    expect(randomStartSeconds(600, () => 0.999)).toBeLessThan(600 * 0.8);
    expect(randomStartSeconds(45, () => 0.5)).toBe(0);
    // A livestream reports no usable duration.
    expect(randomStartSeconds(Infinity, () => 0.5)).toBe(0);
    expect(randomStartSeconds(NaN, () => 0.5)).toBe(0);
  });

  it("picks an index within the playlist, and stays put for one item", () => {
    expect(randomIndex(10, () => 0.55)).toBe(5);
    expect(randomIndex(10, () => 0.999)).toBeLessThan(10);
    expect(randomIndex(1, () => 0.9)).toBe(0);
    expect(randomIndex(0, () => 0.9)).toBe(0);
  });
});

describe("window tree", () => {
  const tree = () => defaultTree();

  it("repairs a half-written file rather than blanking the screen", () => {
    expect(safeTree(null).kind).toBeDefined();
    expect(safeTree({ kind: "leaf", section: "not-a-section" }).kind).toBeDefined();
    // A split with one dead child becomes the surviving child.
    const half = normalizeTree({
      kind: "split", dir: "row", ratio: 0.5,
      children: [{ kind: "leaf", section: "map" }, { kind: "leaf", section: "nope" }],
    });
    expect(half).toMatchObject({ kind: "leaf", section: "map" });
  });

  it("ignores children left behind when a split is replaced by a leaf", () => {
    // The config API deep-merges, so a leaf can arrive carrying a stale
    // `children` array from the split it replaced.
    const merged = normalizeTree({
      kind: "leaf", section: "video",
      children: [{ kind: "leaf", section: "map" }, { kind: "leaf", section: "cameras" }],
    });
    expect(merged).toMatchObject({ kind: "leaf", section: "video" });
  });

  it("clamps ratios so a window can never be dragged shut", () => {
    const t = split("row", 0.5, leaf("map"), leaf("cameras"));
    expect((setSplitRatio(t, t.id, 5) as typeof t).ratio).toBe(MAX_RATIO);
    expect((setSplitRatio(t, t.id, -1) as typeof t).ratio).toBe(MIN_RATIO);
    expect((setSplitRatio(t, t.id, Number.NaN) as typeof t).ratio).toBe(0.5);
  });

  it("splits a window in two and closes it back", () => {
    const t = tree();
    const target = leaves(t)[0];
    const after = splitLeaf(t, target.id, "col", "crime");
    expect(leaves(after)).toHaveLength(leaves(t).length + 1);
    expect(leaves(after).some((l) => l.section === "crime")).toBe(true);

    const closed = closeLeaf(after, leaves(after).find((l) => l.section === "crime")!.id);
    expect(leaves(closed).map((l) => l.section)).toEqual(leaves(t).map((l) => l.section));
  });

  it("refuses to close the last window", () => {
    const only = leaf("video");
    expect(closeLeaf(only, only.id)).toBe(only);
  });

  it("moves a window onto a side of another", () => {
    const t = split("row", 0.5, leaf("map"), leaf("cameras"));
    const [map, cams] = leaves(t);
    const moved = movePane(t, map.id, cams.id, "bottom");
    expect(leaves(moved).map((l) => l.section)).toEqual(["cameras", "map"]);
  });

  it("locks and unlocks one window's cycling", () => {
    const t = tree();
    const id = leaves(t)[0].id;
    expect(leaves(setLeafLocked(t, id, true))[0].locked).toBe(true);
    expect(leaves(setLeafLocked(setLeafLocked(t, id, true), id, false))[0].locked).toBeUndefined();
  });

  it("offers only sections that are not already on screen", () => {
    const t = split("row", 0.5, leaf("map"), leaf("cameras"));
    const spare = unusedSections(t);
    expect(spare).not.toContain("map");
    expect(spare).toContain("weather");
  });

  it("flips and swaps a divider", () => {
    const t = split("row", 0.3, leaf("map"), leaf("cameras"));
    expect((flipSplit(t, t.id) as typeof t).dir).toBe("col");
    const swapped = swapSplit(t, t.id) as typeof t;
    expect(swapped.children.map((c) => (c as { section: string }).section)).toEqual(["cameras", "map"]);
    expect(swapped.ratio).toBeCloseTo(0.7);
  });
});

describe("live camera checks", () => {
  it("checks a channel on its /live page and a video on its watch page", () => {
    // A channel's /live redirects to the stream when there is one, and to the
    // channel when there is not — which is exactly the signal wanted.
    expect(livenessUrl("https://www.youtube.com/channel/UCabcdefghijklmnopqrstu/live"))
      .toBe("https://www.youtube.com/channel/UCabcdefghijklmnopqrstu/live");
    expect(livenessUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
      .toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("leaves alone what it cannot check", () => {
    expect(livenessUrl("PLabc123")).toBeNull();
    expect(livenessUrl("@somehandle")).toBeNull();
    expect(livenessUrl("")).toBeNull();
  });
});

describe("fight cards expiring", () => {
  const now = Date.parse("2026-09-13T04:00:00-04:00");
  const card = (id: string, startsAt: number | null): FightCard => ({
    id, promotion: "UFC", name: id, startsAt, venue: "", location: "",
    posterUrl: null, link: "", fights: [], isToday: false, source: "scrape",
  });

  it("drops an event once its broadcast is over", () => {
    // Last night's card was still leading the panel the next afternoon.
    const out = freshenCards([
      card("lastnight", now - 11 * 3_600_000),
      card("yesterday", now - 23.7 * 3_600_000),
      card("next", now + 6 * 86_400_000),
    ], now);
    expect(out.map((c) => c.id)).toEqual(["next"]);
  });

  it("keeps an event that is on right now and flags it live", () => {
    const out = freshenCards([card("onnow", now - 2 * 3_600_000)], now);
    expect(out).toHaveLength(1);
    expect(out[0].live).toBe(true);
    expect(out[0].isToday).toBe(true);
  });

  it("drops the card the moment its broadcast is over", () => {
    const startsAt = now - CARD_RUNTIME_MS + 60_000; // a minute left
    const before = freshenCards([card("x", startsAt)], now)[0];
    expect(before.live).toBe(true);
    // Two minutes later it is over, and the card is gone entirely.
    expect(freshenCards([card("x", startsAt)], now + 120_000)).toHaveLength(0);
  });

  it("still counts as live when the main event runs past midnight", () => {
    // Started 22:31 yesterday, still on at 04:00. Not "today" by the calendar,
    // but very much on — the panel pins on `live` for exactly this case.
    const out = freshenCards([card("late", now - CARD_RUNTIME_MS + 60_000)], now)[0];
    expect(out.live).toBe(true);
    expect(out.isToday).toBe(false);
  });

  it("keeps a card whose start time is unknown", () => {
    expect(freshenCards([card("tba", null)], now)).toHaveLength(1);
  });

  it("recomputes isToday rather than trusting what was stored", () => {
    // The scrape is hourly; a stored `isToday: true` from last night must not
    // survive into the next day.
    const stale = { ...card("stale", now - 12 * 3_600_000), isToday: true };
    expect(freshenCards([stale], now)).toHaveLength(0);
    const upcoming = { ...card("later", now + 14 * 3_600_000), isToday: false };
    expect(freshenCards([upcoming], now)[0].isToday).toBe(true);
  });
});

describe("TTC route chip", () => {
  it("keeps a real route number", () => {
    expect(routeChip("501", "Streetcar")).toBe("501");
    expect(routeChip("93, 100", "Bus")).toBe("93, 100");
  });

  it("collapses the every-route-in-the-station list to the mode", () => {
    // Station alerts list everything that touches the station, which is wider
    // than the sentence it is labelling.
    expect(routeChip("5,25,34,54,72,100,162,191,325,334,354,403,925,954", "Subway")).toBe("SUB");
    expect(routeChip("1,4,84,97,98,185,320,384,385,984", "")).toBe("10 rts");
  });

  it("falls back to the mode when there is no route at all", () => {
    expect(routeChip("", "Streetcar")).toBe("STR");
  });
});

describe("headline quality", () => {
  it("spots magazine writing that is not news", () => {
    expect(isFluff("The forgotten Chromebook that started it all")).toBe(true);
    expect(isFluff("The best 15 laptops of 2026")).toBe(true);
    expect(isFluff("I spent a week with the new Pixel")).toBe(true);
    expect(isFluff("Everything you need to know about iOS 27")).toBe(true);
  });

  it("leaves actual news alone", () => {
    expect(isFluff("Apple announces AirPods 5")).toBe(false);
    expect(isFluff("TTC closes Line 2 between Broadview and Kennedy")).toBe(false);
    expect(isFluff("Three charged after East York collision")).toBe(false);
  });

  it("ranks a feature below a plain headline of the same age", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const news = scoreItem("Apple announces AirPods 5", "", now, 1, [], now);
    const feature = scoreItem("The forgotten Chromebook that started it all", "", now, 1, [], now);
    expect(feature).toBeLessThan(news);
  });
});

describe("reference writing is not news", () => {
  it("catches explainers and how-tos", () => {
    expect(isFluff("What is infill in 3D printing and is it necessary?")).toBe(true);
    expect(isFluff("How to clean your AirPods")).toBe(true);
    expect(isFluff("Why is my laptop so slow? Explained")).toBe(true);
    expect(isFluff("Internet speeds vs. bandwidth: what's the difference")).toBe(true);
    expect(isFluff("Tips for getting more battery life")).toBe(true);
  });

  it("still leaves reporting alone", () => {
    expect(isFluff("Why Apple pulled the update")).toBe(false);
    expect(isFluff("What Toronto council voted on today")).toBe(false);
    expect(isFluff("Police identify man charged in East York stabbing")).toBe(false);
  });
});

describe("advice and shopping are not news either", () => {
  it("catches reader-advice headlines", () => {
    expect(isFluff("Why you shouldn't sync your phone to a rental car")).toBe(true);
    expect(isFluff("How getting rid of some USB gadgets can improve your setup")).toBe(true);
  });

  it("catches shopping posts, which are ads rather than news", () => {
    expect(isFluff("The MacBook Air M5 is $200 off for the first time")).toBe(true);
    expect(isFluff("The iPad Mini is slightly cheaper again during Prime Day")).toBe(true);
    expect(isFluff("The AirPods Pro 3 are a fantastic deal at $179")).toBe(true);
  });

  it("does not swallow reporting that happens to mention a price", () => {
    expect(isFluff("Apple raises iPhone prices after tariff ruling")).toBe(false);
    expect(isFluff("TTC fare increase approved for January")).toBe(false);
  });
});

describe("question headlines", () => {
  it("treats a headline that asks a question as an explainer", () => {
    expect(isFluff("How much does DDR5 RAM speed matter for gaming?")).toBe(true);
    expect(isFluff("How has Apple's Mac Studio changed over the years?")).toBe(true);
    expect(isFluff("What's the difference between battery capacity and life?")).toBe(true);
  });

  it("leaves statements alone", () => {
    expect(isFluff("Rogers outage hits downtown Toronto")).toBe(false);
    expect(isFluff("Apple announces AirPods 5")).toBe(false);
  });
});

describe("headline summaries", () => {
  it("drops a summary that just repeats the headline", () => {
    expect(cleanSummary("Apple announces AirPods 5", "Apple announces AirPods 5")).toBe("");
    expect(cleanSummary("Rogers outage hits Toronto", "<p>Rogers outage hits Toronto</p>")).toBe("");
  });

  it("strips the outlet credit a curated feed puts in front", () => {
    const out = cleanSummary(
      "OpenAI fires workers",
      "Politico: Staff were dismissed after an internal review found documents had been shared.",
    );
    expect(out.startsWith("Staff were dismissed")).toBe(true);
  });

  it("strips markup and squeezes whitespace", () => {
    expect(cleanSummary("A", "<b>Two</b>   lines\nof   text")).toBe("Two lines of text");
  });

  it("cuts long text on a word boundary", () => {
    const long = "The council voted to approve the new transit line after a long debate that ran past midnight and drew dozens of speakers from across the city.";
    const out = cleanSummary("Council approves transit line", long, 60);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it("keeps a short summary as it is", () => {
    expect(cleanSummary("Headline here", "A different sentence entirely.")).toBe("A different sentence entirely.");
  });
});

describe("gadget-blog house style", () => {
  it("is treated as filler", () => {
    expect(isFluff("This little-known app lets you display song lyrics on Apple CarPlay")).toBe(true);
    expect(isFluff("Customizing your Samsung Galaxy phone is a bit easier with One UI 9")).toBe(true);
    expect(isFluff("Why this ancient cable still connects to modern TVs")).toBe(true);
  });
});
