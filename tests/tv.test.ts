import { describe, expect, it } from "vitest";
import { escapeHtml, renderTv, tvPages, type TvData } from "../src/lib/tv";
import { DEFAULT_CONFIG } from "../src/lib/config";
import type { AppState } from "../src/lib/state";

const NOW = new Date(2026, 9, 19, 18, 0).getTime();

function state(over: Partial<AppState> = {}): AppState {
  return {
    now: NOW,
    build: "test",
    config: DEFAULT_CONFIG,
    weather: {
      at: NOW,
      data: {
        place: "Toronto", observed: NOW, tempC: 6, feelsLikeC: 3, condition: "Mainly clear", iconUrl: null,
        humidity: 49, windKph: 13, windDir: "WSW", sunrise: NOW - 10 * 3600e3, sunset: NOW + 3600e3, aqi: 20,
        nowcast: [], hourly: [{ at: NOW + 3600e3, tempC: 5, condition: "Clear", pop: null }],
        daily: [{ day: "Monday", hiC: 16, loC: 5, condition: "Sunny", pop: null }], warnings: [],
      },
    },
    traffic: { data: [], at: NOW },
    breaking: [],
    transit: [],
    fights: { data: [], at: NOW },
    tech: [{ id: "a", kind: "tech", sourceId: "news.verge", title: "Chips & <dips>", body: "", link: "", published: NOW - 600e3, fetched: NOW, weight: 1, meta: { source: "Verge" } }],
    local: [],
    crime: [],
    events: [],
    camStatus: [],
    pickup: { calendar: "Thursday2", next: [{ date: "2026-10-22", items: ["Recycling", "Green Bin"] }] },
    market: [],
    holidays: [],
    fx: { rate: 1.4154, prev: 1.4196, date: "2026-10-16" },
    health: [],
    jobs: [],
    ...over,
  } as AppState;
}

const data = (over: Partial<TvData> = {}): TvData => ({ state: state(), board: [], printer: null, radarFrame: null, now: NOW, ...over });

describe("TV page for old browsers", () => {
  it("escapes text that came from the outside world", () => {
    expect(escapeHtml('<b>"Tom & Jerry"</b>')).toBe("&lt;b&gt;&quot;Tom &amp; Jerry&quot;&lt;/b&gt;");
  });

  it("skips pages with nothing to show", () => {
    expect(tvPages({ state: state(), printer: null })).toEqual(["now", "headlines", "roads", "radar"]);
  });

  it("is plain HTML that refreshes itself into the next page", () => {
    const html = renderTv(data(), "now", 20);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<meta http-equiv="refresh" content="20;url=/tv?p=1&amp;s=20">');
    expect(html).toContain("Bins Thu");
    expect(html).toContain("USD/CAD");
    expect(html).not.toMatch(/https:\/\//); // the PS3 cannot fetch HTTPS
  });

  it("wraps around from the last page to the first", () => {
    const html = renderTv(data(), "radar", 30);
    expect(html).toContain("url=/tv?p=0&amp;s=30");
  });

  it("escapes headlines", () => {
    const html = renderTv(data(), "headlines", 20);
    expect(html).toContain("Chips &amp; &lt;dips&gt;");
    expect(html).not.toContain("<dips>");
  });

  it("draws the radar from the dashboard's own http routes", () => {
    const html = renderTv(data({ radarFrame: "2026-10-19T21:54:00Z" }), "radar", 20);
    expect(html).toContain("/api/radar/frame?layer=RADAR_1KM_RRAI&amp;time=2026-10-19T21%3A54%3A00Z");
    expect(html).toContain("/api/radar/tile/");
  });
});
