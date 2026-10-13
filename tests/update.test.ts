import { describe, expect, it } from "vitest";
import { frameTimes, radarGrid, tileOf } from "../src/lib/radar";
import { localDate, nextPickups, parseSchedule } from "../src/lib/sources/pickup";
import { binsReminder, daysUntil, pickupDay } from "../src/lib/format";
import { extractArticle, isPublicUrl, youtubeId } from "../src/lib/reader";
import { readTrays } from "../src/lib/printer";

describe("radar", () => {
  it("lists the newest frames from a WMS time dimension, oldest first", () => {
    const t = frameTimes("2026-10-13T00:54:00Z/2026-10-13T03:54:00Z/PT6M", 3);
    expect(t).toEqual(["2026-10-13T03:42:00Z", "2026-10-13T03:48:00Z", "2026-10-13T03:54:00Z"]);
  });

  it("returns nothing for a dimension it cannot read", () => {
    expect(frameTimes("garbage")).toEqual([]);
  });

  it("puts home inside the tile mosaic and the box in web-mercator metres", () => {
    const g = radarGrid(43.70438, -79.31837);
    const [x, y] = g.px(43.70438, -79.31837);
    expect(x).toBeGreaterThan(0.3 * g.width);
    expect(x).toBeLessThan(0.7 * g.width);
    expect(y).toBeGreaterThan(0.3 * g.height);
    expect(y).toBeLessThan(0.7 * g.height);
    expect(g.bbox[0]).toBeLessThan(-8_830_000); // Toronto is about -8.83e6 m east
    expect(g.bbox[2]).toBeGreaterThan(-8_830_000);
    expect(tileOf(0, 0, 1)).toEqual({ x: 1, y: 1 });
  });
});

describe("garbage day", () => {
  const csv = [
    "_id,Calendar,WeekStarting,GreenBin,Garbage,Recycling,YardWaste,ChristmasTree",
    "1,Thursday2,10/08/26,R,0,R,0,0",
    "2,Thursday2,10/15/26,R,R,0,R,0",
    "3,Friday1,10/16/26,F,F,0,0,0",
    "4,Thursday2,12/26/26,S,S,0,0,0",
  ].join("\n");

  it("reads one calendar's dates and what goes out", () => {
    const d = parseSchedule(csv, "Thursday2");
    expect(d).toEqual([
      { date: "2026-10-08", items: ["Recycling", "Green Bin"] },
      { date: "2026-10-15", items: ["Garbage", "Green Bin", "Yard Waste"] },
      { date: "2026-12-26", items: ["Garbage", "Green Bin"] },
    ]);
  });

  it("finds the next collections against the clock", () => {
    const d = parseSchedule(csv, "Thursday2");
    const now = new Date(2026, 9, 13, 9, 0).getTime();
    expect(localDate(now)).toBe("2026-10-13");
    expect(nextPickups(d, now, 1)[0].date).toBe("2026-10-15");
    // On the day itself, it is still the next one until the day is over.
    expect(nextPickups(d, new Date(2026, 9, 15, 20, 0).getTime(), 1)[0].date).toBe("2026-10-15");
  });

  it("reminds the evening before and the morning of, and not otherwise", () => {
    expect(binsReminder("2026-10-15", new Date(2026, 9, 14, 18, 0).getTime())).toBe("tonight");
    expect(binsReminder("2026-10-15", new Date(2026, 9, 14, 10, 0).getTime())).toBeNull();
    expect(binsReminder("2026-10-15", new Date(2026, 9, 15, 7, 0).getTime())).toBe("today");
    expect(binsReminder("2026-10-15", new Date(2026, 9, 15, 13, 0).getTime())).toBeNull();
  });

  it("names the day", () => {
    const now = new Date(2026, 9, 13, 9, 0).getTime();
    expect(daysUntil("2026-10-15", now)).toBe(2);
    expect(pickupDay("2026-10-13", now)).toBe("Today");
    expect(pickupDay("2026-10-14", now)).toBe("Tomorrow");
    expect(pickupDay("2026-10-15", now)).toMatch(/^Thu/);
  });
});

describe("reader", () => {
  const page = `<!doctype html><html><head>
    <title>Fallback title</title>
    <meta property="og:title" content="Subway closure this weekend &amp; shuttle buses">
    <meta property="og:site_name" content="CityNews">
    <meta property="og:image" content="/img/hero.jpg">
    <meta property="article:published_time" content="2026-10-12T14:00:00Z">
    </head><body>
    <nav><p>Home News Sports Weather and a very long navigation line that should vanish</p></nav>
    <article>
      <h1>Subway closure</h1>
      <p>Line 2 will be closed between Broadview and Woodbine stations all weekend for track work.</p>
      <p>Shuttle buses will run every few minutes, stopping at each station along the way.</p>
      <h2>What to expect</h2>
      <p>Riders should allow up to 20 minutes of extra travel time, the TTC said on Monday.</p>
      <p>Sign up for our newsletter to get updates.</p>
      <script>var tracking = "<p>not a paragraph at all, just script content</p>";</script>
    </article>
    <footer><p>All rights reserved by the publisher of this website, which is footer text.</p></footer>
    </body></html>`;

  it("pulls the title, picture and story text out of a news page", () => {
    const a = extractArticle(page, "https://toronto.citynews.ca/2026/10/12/closure/");
    expect(a.title).toBe("Subway closure this weekend & shuttle buses");
    expect(a.site).toBe("CityNews");
    expect(a.image).toBe("https://toronto.citynews.ca/img/hero.jpg");
    expect(a.published).toBe(Date.parse("2026-10-12T14:00:00Z"));
    expect(a.blocks.map((b) => b.kind)).toEqual(["p", "p", "h", "p"]);
    expect(a.blocks[0].text).toMatch(/^Line 2 will be closed/);
    expect(JSON.stringify(a.blocks)).not.toMatch(/newsletter|navigation|footer|script content/);
  });

  it("prefers the full structured-data body when the page has one", () => {
    const body = Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1} of the story, long enough to count as the real thing.`).join("\n\n");
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@type": "NewsArticle", headline: "H", articleBody: body,
    })}</script></head><body><article><p>Just a short teaser paragraph sitting in the page markup.</p></article></body></html>`;
    const a = extractArticle(html, "https://example.com/a");
    expect(a.blocks.length).toBe(8);
    expect(a.blocks[0].text).toMatch(/^Paragraph 1 /);
  });

  it("only fetches public web pages", () => {
    expect(isPublicUrl("https://www.cbc.ca/news")).toBe(true);
    expect(isPublicUrl("http://192.168.2.200/")).toBe(false);
    expect(isPublicUrl("http://127.0.0.1:3100/api/state")).toBe(false);
    expect(isPublicUrl("http://localhost/")).toBe(false);
    expect(isPublicUrl("http://printer.local/")).toBe(false);
    expect(isPublicUrl("http://10.0.0.1/")).toBe(false);
    expect(isPublicUrl("file:///C:/Windows")).toBe(false);
    expect(isPublicUrl("http://user:pw@example.com/")).toBe(false);
  });

  it("recognises YouTube links so they play instead of being read", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=bbjwotvAvDM")).toBe("bbjwotvAvDM");
    expect(youtubeId("https://youtu.be/HongS1sx4pY")).toBe("HongS1sx4pY");
    expect(youtubeId("https://www.cbc.ca/news")).toBeNull();
  });
});

describe("printer filament", () => {
  it("lists AMS slots with colour, type, what is left and which is feeding", () => {
    const report = {
      ams: {
        tray_now: "3",
        ams: [{
          id: "0", humidity_raw: "35",
          tray: [
            { id: "0", tray_type: "PLA", tray_sub_brands: "PLA Basic", tray_color: "8E9089FF", remain: 18 },
            { id: "1", tray_type: "PLA", tray_sub_brands: "", tray_color: "FFFFFFFF", remain: -1 },
            { id: "2", tray_type: "", tray_color: "00000000", remain: 0 },
            { id: "3", tray_type: "PETG", tray_color: "161616FF", remain: -1 },
          ],
        }],
      },
    };
    const { trays, humidity } = readTrays(report);
    expect(humidity).toBe(35);
    expect(trays.map((t) => t.slot)).toEqual(["A1", "A2", "A3", "A4"]);
    expect(trays[0]).toMatchObject({ type: "PLA", name: "PLA Basic", color: "#8E9089", remain: 18, active: false });
    expect(trays[1].remain).toBeNull();
    expect(trays[3].active).toBe(true);
  });

  it("copes with a printer that has no AMS", () => {
    expect(readTrays({})).toEqual({ trays: [], humidity: null });
  });
});

describe("event links", () => {
  it("gives a bare website a scheme so it cannot navigate the kiosk to itself", async () => {
    const { webLink } = await import("../src/lib/format");
    expect(webLink("appletreemarkets.ca")).toBe("https://appletreemarkets.ca");
    expect(webLink("www.toronto.ca/events/x")).toBe("https://www.toronto.ca/events/x");
    expect(webLink("https://example.com/a")).toBe("https://example.com/a");
    expect(webLink("call 416-555-0100")).toBe("");
    expect(webLink(null)).toBe("");
  });
});

describe("next buses board", () => {
  it("picks the stop nearest home for each direction a rider can use", async () => {
    const { boardStops } = await import("../src/lib/sources/ttcmap");
    const raw = {
      route: {
        tag: "70",
        stop: [
          { tag: "1", lat: "43.7050", lon: "-79.3120", title: "O'Connor Dr At St Clair Ave East" },
          { tag: "2", lat: "43.7300", lon: "-79.2900", title: "Far away" },
          { tag: "3", lat: "43.7052", lon: "-79.3122", title: "O'Connor Dr At St Clair (other side)" },
        ],
        direction: [
          { tag: "70_0_70dc", name: "West", title: "West - 70 O'Connor towards Coxwell Station", useForUI: "true", stop: [{ tag: "2" }, { tag: "1" }] },
          { tag: "70_1_dc70", name: "East", title: "East - 70 O'Connor towards Eglinton", useForUI: "true", stop: [{ tag: "3" }, { tag: "2" }] },
          { tag: "70_1_garage", name: "East", title: "Garage trip", useForUI: "false", stop: [{ tag: "1" }] },
        ],
      },
    };
    const out = boardStops(raw, { lat: 43.7057, lon: -79.3126 });
    expect(out.map((s) => [s.stop, s.dir, s.heading, s.towards])).toEqual([
      ["1", "70_0", "West", "Coxwell Station"],
      ["3", "70_1", "East", "Eglinton"],
    ]);
  });
});

describe("next buses board branches", () => {
  it("shows one row for two branches that stop at the same place", async () => {
    const { boardStops } = await import("../src/lib/sources/ttcmap");
    const raw = {
      route: {
        tag: "91",
        stop: [{ tag: "5", lat: "43.705", lon: "-79.312", title: "O'Connor Dr At Glenwood" }],
        direction: [
          { tag: "91_0_91A", name: "South", title: "South - 91a Woodbine towards Woodbine Station via Eglinton and Sunrise", stop: [{ tag: "5" }] },
          { tag: "91_0_91", name: "South", title: "South - 91 Woodbine towards Woodbine Station", stop: [{ tag: "5" }] },
        ],
      },
    };
    const out = boardStops(raw, { lat: 43.705, lon: -79.312 });
    expect(out).toHaveLength(1);
    expect(out[0].towards).toBe("Woodbine Station");
  });
});

describe("short stop names", () => {
  it("cuts a TTC stop name to what identifies it", async () => {
    const { shortStop } = await import("../src/lib/format");
    expect(shortStop("O'Connor Dr At Glenwood Cres West Side")).toBe("O'Connor @ Glenwood W side");
    expect(shortStop("St Clair Ave East At Denvale Rd")).toBe("St Clair E @ Denvale");
  });
});
