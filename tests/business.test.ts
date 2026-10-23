import { describe, expect, it } from "vitest";
import { isPrintedProduct, mergeSellers, parseEbayCards, rankSellers, soldInLastDay } from "../src/lib/sources/ebay";
import { occasionsFor, requestPlace, sellableLicense, upcomingOccasions } from "../src/lib/business";
import { parseTrends, toTrendingModel } from "../src/lib/sources/ideas";
import { relevant } from "../src/lib/sources/market";
import { printablesTarget } from "../src/lib/printablesReader";

const H = 3_600_000;

describe("eBay best sellers", () => {
  const card = (id: string, title: string, sold: string, price = "$33.00") =>
    `<li class=s-card data-listingid=${id}><img src="https://i.ebayimg.com/images/g/abc/s-l140.jpg">` +
    `<div role=heading class=s-card__title><span class="x">${title}</span></div>` +
    `<span class="s-card__price">${price}</span><span class="b">${sold} sold</span></li>`;

  it("reads id, title, price, sold count and a bigger photo from each card", () => {
    const html = card("196998834475", "3D Printed Gauge Pod &amp; Mount", "1,069") + card("111111111111", "No sales yet", "");
    const out = parseEbayCards(html);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: "196998834475", title: "3D Printed Gauge Pod & Mount", price: "$33.00", sold: 1069,
      image: "https://i.ebayimg.com/images/g/abc/s-l300.jpg",
    });
  });

  it("keeps printed products and drops printer hardware", () => {
    expect(isPrintedProduct("3D Printed Articulated Dragon")).toBe(true);
    expect(isPrintedProduct("3DMakerpro Handheld 3D Scanner for 3D Printing")).toBe(false);
    expect(isPrintedProduct("PLA Filament 1.75mm for 3D printers")).toBe(false);
    expect(isPrintedProduct("Wooden dragon carving")).toBe(false);
  });

  it("works out sales in the last day from the reading a day earlier", () => {
    const now = 100 * H;
    expect(soldInLastDay([{ at: now, sold: 50 }], now)).toBeNull();
    expect(soldInLastDay([{ at: now - 25 * H, sold: 40 }, { at: now - 4 * H, sold: 46 }, { at: now, sold: 52 }], now)).toBe(12);
  });

  it("merges readings and ranks by the last day once known", () => {
    const now = 100 * H;
    const day1 = mergeSellers([], [
      { id: "a", title: "A", price: "$1", sold: 100, image: null, query: "q" },
      { id: "b", title: "B", price: "$1", sold: 10, image: null, query: "q" },
    ], now - 24 * H);
    expect(rankSellers(day1).map((s) => s.id)).toEqual(["a", "b"]); // by total
    const day2 = mergeSellers(day1, [
      { id: "a", title: "A", price: "$1", sold: 101, image: null, query: "q" },
      { id: "b", title: "B", price: "$1", sold: 25, image: null, query: "q" },
    ], now);
    const ranked = rankSellers(day2);
    expect(ranked.map((s) => [s.id, s.soldToday])).toEqual([["b", 15], ["a", 1]]);
  });
});

describe("the print shop calendar", () => {
  it("knows this year's moving dates", () => {
    const o = Object.fromEntries(occasionsFor(2026).map((x) => [x.name, x.date]));
    expect(o["Mother's Day"]).toBe("2026-05-10");
    expect(o["Father's Day"]).toBe("2026-06-21");
    expect(o["Easter"]).toBe("2026-04-05");
    expect(o["Thanksgiving"]).toBe("2026-10-12");
    expect(o["Black Friday"]).toBe("2026-11-27");
  });

  it("lists what is coming with how long until listings should be up", () => {
    const now = new Date(2026, 9, 23, 9).getTime();
    const up = upcomingOccasions(now, 75);
    expect(up[0]).toMatchObject({ name: "Halloween", daysAway: 8 });
    expect(up[0].listInDays).toBeLessThan(0); // already past the four-week lead
    expect(up.map((u) => u.name)).toContain("Christmas");
  });
});

describe("licences and places", () => {
  it("only calls a model sellable when its licence allows commercial use", () => {
    expect(sellableLicense("CC-BY")).toBe(true);
    expect(sellableLicense("CC0")).toBe(true);
    expect(sellableLicense("GPL 3.0")).toBe(true);
    expect(sellableLicense("CC-BY-NC-SA")).toBe(false);
    expect(sellableLicense("Standard Digital File License")).toBe(false);
    expect(sellableLicense("")).toBe(false);
  });

  it("tells a local print request from one far away", () => {
    expect(requestPlace("[CA-ON] Need a bracket printed in Toronto")).toBe("toronto");
    expect(requestPlace("[CA-ON] Replacement knob")).toBe("ontario");
    expect(requestPlace("[Canada] Cosplay helmet")).toBe("canada");
    expect(requestPlace("[US-CA] EGPU enclosure")).toBe("elsewhere");
    expect(requestPlace("[US / Oregon] Chair parts")).toBe("elsewhere");
  });
});

describe("live ideas", () => {
  it("reads Google Trends' daily feed", () => {
    const xml = `<rss><channel><item><title>Blue Jays</title><ht:approx_traffic>200K+</ht:approx_traffic>
      <ht:news_item><ht:news_item_title><![CDATA[Jays win &amp; advance]]></ht:news_item_title></ht:news_item></item></channel></rss>`;
    expect(parseTrends(xml)).toEqual([{ query: "Blue Jays", traffic: "200K+", context: "Jays win & advance" }]);
  });

  it("turns a Printables print into a catalogue entry with its licence judged", () => {
    const m = toTrendingModel({
      id: "1862057", name: "Pegboard", slug: "pegboard", likesCount: 1145, downloadCount: 3283,
      image: { filePath: "media/prints/x.png" }, category: { name: "Tools" }, license: { abbreviation: "CC-BY", name: "Creative Commons — Attribution" },
    });
    expect(m).toMatchObject({
      url: "https://www.printables.com/model/1862057-pegboard",
      image: "https://media.printables.com/media/prints/thumbs/cover/320x240/png/x.webp",
      sellable: true, likes: 1145,
    });
  });

  it("recognises Printables model and search links for the reader", () => {
    expect(printablesTarget("https://www.printables.com/model/1862057-pegboard")).toEqual({ kind: "model", id: "1862057" });
    expect(printablesTarget("https://www.printables.com/search/models?q=cake%20topper")).toEqual({ kind: "search", q: "cake topper" });
    expect(printablesTarget("https://www.ebay.com/itm/1")).toBeNull();
  });
});

describe("local print requests", () => {
  it("keeps only people asking, for the requests search", () => {
    const leads = { match: "3d|print", exclude: "selling", wanted: true };
    expect(relevant("Looking for someone to 3D print a part", leads)).toBe(true);
    expect(relevant("Need a 3d print of my logo", leads)).toBe(true);
    expect(relevant("3D printed dragons for sale", leads)).toBe(false);
    // Every other search still drops requests.
    expect(relevant("Looking for 3d printer", { match: "printer" })).toBe(false);
  });
});

describe("the built-in requests search", () => {
  it("drops sellers and keeps people asking", async () => {
    const { DEFAULT_CONFIG } = await import("../src/lib/config");
    const leads = DEFAULT_CONFIG.market.searches.find((s) => s.id === "leads")!;
    expect(relevant("Ender 3 V2 3D Printer - Needs Glass Thermistor COMES WITH MODS", leads)).toBe(false);
    expect(relevant("Bambu A1 printer for sale", leads)).toBe(false);
    expect(relevant("Looking for someone with a 3D printer", leads)).toBe(true);
    expect(relevant("Need a part 3d printed", leads)).toBe(true);
  });
});

describe("saved listings and changed filters", () => {
  it("drops saved listings a tightened filter would now reject", async () => {
    const { stillWanted } = await import("../src/lib/sources/market");
    const l = (title: string, search: string) => ({ id: title, source: "karrot" as const, search, title, price: "", place: "", image: null, url: "", postedAt: null, firstSeen: 0 });
    const out = stillWanted(
      [l("Ender 3 V2 Printer - Needs thermistor COMES WITH MODS", "leads"), l("Need a bracket 3d printed", "leads"), l("Old search item", "gone")],
      [{ id: "leads", label: "Requests", queries: [], match: "3d|print", exclude: "comes with", wanted: true }],
    );
    expect(out.map((x) => x.title)).toEqual(["Need a bracket 3d printed"]);
  });
});

describe("Printables thumbnails", () => {
  it("points at the small WebP instead of the full photo", async () => {
    const { printablesThumb } = await import("../src/lib/business");
    expect(printablesThumb("media/prints/278015/images/2465197_ab/img_6304.jpg"))
      .toBe("https://media.printables.com/media/prints/278015/images/2465197_ab/thumbs/cover/320x240/jpg/img_6304.webp");
    expect(printablesThumb("media/prints/x/images/y/cover.PNG"))
      .toBe("https://media.printables.com/media/prints/x/images/y/thumbs/cover/320x240/png/cover.webp");
    expect(printablesThumb(null)).toBeNull();
  });
});
