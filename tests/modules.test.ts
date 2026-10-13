import { describe, expect, it } from "vitest";
import { EventSplitter, toLocalEvent, upcomingEvents } from "../src/lib/sources/events";
import { parsePredictions } from "../src/lib/sources/departures";
import { addFeature, simplify, type Streets } from "../src/lib/sources/streets";
import { mergeReport, readPackets, summarize } from "../src/lib/printer";
import { duration, eventWhen } from "../src/lib/format";
import { DEFAULT_CONFIG, SECRET_MASK, publicConfig } from "../src/lib/config";

const HOME = { lat: 43.7005, lon: -79.3255 };
const NOW = new Date(2026, 9, 5, 8, 0).getTime();
const HOUR = 3_600_000;

describe("events feed splitting", () => {
  it("pulls each event out of the export, across chunk boundaries", () => {
    const text = '{"value":[{"a":1,"s":"brace } inside"},{"b":{"c":[1,2]}},{"q":"esc \\" quote {"}]}';
    const splitter = new EventSplitter();
    const out: string[] = [];
    for (let i = 0; i < text.length; i += 7) out.push(...splitter.push(text.slice(i, i + 7)));
    expect(out.map((o) => JSON.parse(o))).toEqual([
      { a: 1, s: "brace } inside" },
      { b: { c: [1, 2] } },
      { q: 'esc " quote {' },
    ]);
  });
});

describe("local events", () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    submission_id: "sub-1",
    event_name: "East York Farmers' Market",
    event_status: "Approved",
    free_event: "Yes",
    featured_event: "No",
    event_category: ["Farmers' Market"],
    event_dates: [{ date: NOW + 24 * HOUR }, { date: NOW - 30 * 24 * HOUR }],
    event_locations: [{ location_name: "East York Civic Centre", location_gps: '[{"gps_lat":43.6955,"gps_lng":-79.3333}]' }],
    ...over,
  });

  it("keeps a nearby event with its upcoming dates only", () => {
    const e = toLocalEvent(raw(), NOW, HOME, 8);
    expect(e?.name).toBe("East York Farmers' Market");
    expect(e?.venue).toBe("East York Civic Centre");
    expect(e?.dates).toEqual([NOW + 24 * HOUR]);
    expect(e?.distanceKm).toBeGreaterThan(0.5);
    expect(e?.distanceKm).toBeLessThan(1.5);
    expect(e?.free).toBe(true);
  });

  it("drops far-away events unless the City features them", () => {
    const far = { event_locations: [{ location_name: "Etobicoke", location_gps: '[{"gps_lat":43.59,"gps_lng":-79.54}]' }] };
    expect(toLocalEvent(raw(far), NOW, HOME, 8)).toBeNull();
    expect(toLocalEvent(raw({ ...far, featured_event: "Yes" }), NOW, HOME, 8)).not.toBeNull();
  });

  it("drops unapproved events and ones with nothing upcoming", () => {
    expect(toLocalEvent(raw({ event_status: "Pending" }), NOW, HOME, 8)).toBeNull();
    expect(toLocalEvent(raw({ event_dates: [{ date: NOW - 48 * HOUR }] }), NOW, HOME, 8)).toBeNull();
  });

  it("orders by next date and lets past dates fall away as the clock moves", () => {
    const a = toLocalEvent(raw({ submission_id: "a", event_dates: [{ date: NOW + 2 * HOUR }, { date: NOW + 50 * HOUR }] }), NOW, HOME, 8)!;
    const b = toLocalEvent(raw({ submission_id: "b", event_dates: [{ date: NOW + 5 * HOUR }] }), NOW, HOME, 8)!;
    expect(upcomingEvents([b, a], NOW).map((e) => e.id)).toEqual(["a", "b"]);
    // Six hours on, a's first date is past its grace and b leads.
    const later = upcomingEvents([a, b], NOW + 6 * HOUR);
    expect(later.map((e) => e.id)).toEqual(["a", "b"].reverse());
    expect(later.find((e) => e.id === "a")?.dates[0]).toBe(NOW + 50 * HOUR);
  });

  it("puts daily exhibits after one-off events", () => {
    const daily = toLocalEvent(
      raw({ submission_id: "daily", event_dates: [0, 1, 2, 3, 4, 5].map((d) => ({ date: NOW + 1 * HOUR + d * 24 * HOUR })) }),
      NOW, HOME, 8,
    )!;
    const once = toLocalEvent(raw({ submission_id: "once", event_dates: [{ date: NOW + 30 * HOUR }] }), NOW, HOME, 8)!;
    const out = upcomingEvents([daily, once], NOW);
    expect(out.map((e) => e.id)).toEqual(["once", "daily"]);
    expect(out[1].ongoing).toBe(true);
    expect(out[0].ongoing).toBe(false);
  });

  it("says when, the way a calendar would", () => {
    expect(eventWhen(NOW - HOUR, NOW).day).toBe("NOW");
    expect(eventWhen(NOW + 10 * HOUR, NOW)).toEqual({ day: "TODAY", time: "6p" });
    expect(eventWhen(NOW + 24 * HOUR + 30 * 60_000, NOW)).toEqual({ day: "TMRW", time: "8:30a" });
  });
});

describe("TTC departures", () => {
  it("reads predictions and keeps only the wanted direction", () => {
    const json = {
      predictions: {
        direction: [
          { prediction: [{ epochTime: "2000", vehicle: "8479", affectedByLayover: "true", dirTag: "93_0_93" }] },
          { prediction: { epochTime: "1000", vehicle: "8500", dirTag: "93_1_93pm" } },
        ],
      },
    };
    expect(parsePredictions(json, "93_0")).toEqual([{ at: 2000, vehicle: "8479", scheduled: true }]);
    expect(parsePredictions(json).map((d) => d.at)).toEqual([1000, 2000]);
  });

  it("copes with a single prediction and with none", () => {
    expect(parsePredictions({ predictions: { direction: { prediction: { epochTime: "5" } } } })).toHaveLength(1);
    expect(parsePredictions({ predictions: { dirTitleBecauseNoPredictions: "x" } })).toEqual([]);
  });
});

describe("street outlines", () => {
  const box = { latMin: 43.66, latMax: 43.73, lonMin: -79.38, lonMax: -79.27 };
  const seg = (kind: string, coords: [number, number][]) => ({
    properties: { FEATURE_CODE_DESC: kind },
    geometry: { type: "MultiLineString", coordinates: [coords] },
  });
  const here: [number, number][] = [[-79.3, 43.7], [-79.301, 43.701]];

  it("sorts City centreline segments into major and minor, dropping trails", () => {
    const s: Streets = { major: [], minor: [] };
    addFeature(s, seg("Major Arterial", here), box);
    addFeature(s, seg("Collector", here), box);
    addFeature(s, seg("Local", here), box);
    addFeature(s, seg("Trail", here), box);
    addFeature(s, seg("Laneway", here), box);
    expect(s.major).toHaveLength(2);
    expect(s.minor).toHaveLength(1);
  });

  it("keeps only segments inside the map", () => {
    const s: Streets = { major: [], minor: [] };
    addFeature(s, seg("Local", [[-79.54, 43.58], [-79.541, 43.581]]), box);
    expect(s.minor).toHaveLength(0);
  });

  it("thins points that are metres apart but keeps the ends", () => {
    const pts: [number, number][] = [[-79.3, 43.7], [-79.30001, 43.70001], [-79.30002, 43.70002]];
    expect(simplify(pts)).toEqual([[-79.3, 43.7], [-79.30002, 43.70002]]);
  });
});

describe("printer messages", () => {
  it("splits MQTT packets and keeps a partial one for later", () => {
    const pkt = Buffer.from([0x30, 3, 1, 2, 3]);
    const { packets, rest } = readPackets(Buffer.concat([pkt, Buffer.from([0x30, 5, 9])]));
    expect(packets).toHaveLength(1);
    expect(packets[0].type).toBe(3);
    expect([...packets[0].body]).toEqual([1, 2, 3]);
    expect([...rest]).toEqual([0x30, 5, 9]);
  });

  it("merges partial reports into the full picture", () => {
    const full = mergeReport({ gcode_state: "RUNNING", mc_percent: 10, ipcam: { rtsp_url: "disable", resolution: "1080p" } }, {});
    mergeReport(full, { mc_percent: 49, ipcam: { rtsp_url: "rtsps://x" } });
    const s = summarize(full, 1);
    expect(s.state).toBe("RUNNING");
    expect(s.percent).toBe(49);
    expect((full.ipcam as Record<string, string>).resolution).toBe("1080p");
  });

  it("formats time left", () => {
    expect(duration(1355)).toBe("22h 35m");
    expect(duration(48)).toBe("48m");
    expect(duration(null)).toBe("--");
  });
});

describe("secrets stay on the server", () => {
  it("masks the printer access code in what the browser gets", () => {
    const cfg = { ...DEFAULT_CONFIG, printer: { label: "P", host: "1.2.3.4", serial: "S", accessCode: "12345678" } };
    expect(publicConfig(cfg).printer.accessCode).toBe(SECRET_MASK);
    expect(publicConfig(DEFAULT_CONFIG).printer.accessCode).toBe("");
  });
});
