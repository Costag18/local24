import { describe, expect, it } from "vitest";
import { listedAt, mergeListings, parseFacebook, parseKarrot, parseKijiji, relevant } from "../src/lib/sources/market";
import { DEFAULT_CONFIG } from "../src/lib/config";
import type { Listing } from "../src/lib/types";

const search = (id: string) => DEFAULT_CONFIG.market.searches.find((s) => s.id === id)!;

describe("facebook marketplace", () => {
  const listing = (over: Record<string, unknown>) => ({
    __typename: "GroupCommerceProductItem",
    id: "1608208950757021",
    marketplace_listing_title: "Creality Ender V3 2 Neo - 3D Printer",
    listing_price: { formatted_amount: "CA$100", amount: "100.00" },
    location: { reverse_geocode: { city: "Toronto", state: "ON" } },
    primary_listing_photo: { image: { uri: "https://scontent.example/x.jpg" } },
    creation_time: 1791848029,
    is_sold: false, is_pending: false, is_hidden: false,
    marketplace_listing_seller: { name: "Someone Private" },
    ...over,
  });
  const html = (...items: unknown[]) =>
    `<html><script type="application/json" data-sjs>${JSON.stringify({ require: [[{ edges: items.map((node) => ({ node: { listing: node } })) }]] })}</script></html>`;

  it("reads title, price, city, photo, link and posting time", () => {
    const [l] = parseFacebook(html(listing({})));
    expect(l).toMatchObject({
      id: "fb:1608208950757021",
      source: "facebook",
      title: "Creality Ender V3 2 Neo - 3D Printer",
      price: "$100",
      place: "Toronto, ON",
      city: "Toronto",
      image: "https://scontent.example/x.jpg",
      url: "https://www.facebook.com/marketplace/item/1608208950757021/",
      postedAt: 1791848029000,
    });
    // The seller's name is never kept.
    expect(JSON.stringify(l)).not.toContain("Someone Private");
  });

  it("skips sold listings and reads free ones", () => {
    const out = parseFacebook(html(listing({ is_sold: true }), listing({ id: "2", listing_price: { amount: "0.00" } })));
    expect(out).toHaveLength(1);
    expect(out[0].price).toBe("Free");
  });
});

describe("kijiji", () => {
  it("reads listings out of the page's Next.js data", () => {
    const data = {
      props: { pageProps: { __APOLLO_STATE__: { a: {
        __typename: "StandardListing",
        id: "1652503437",
        title: "Bambu Lab A1 mini",
        imageUrls: ["https://media.kijiji.ca/x.jpg"],
        url: "https://www.kijiji.ca/v-buy-sell-other/city-of-toronto/bambu/1652503437",
        activationDate: "2026-10-12T22:39:25.000Z",
        location: { name: "Toronto", address: "O'Connor Dr, East York, ON", coordinates: { latitude: 43.70, longitude: -79.31 } },
        price: { type: "FIXED", amount: 32000 },
      } } } },
    };
    const [l] = parseKijiji(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`);
    expect(l).toMatchObject({
      id: "kj:1652503437", source: "kijiji", title: "Bambu Lab A1 mini", price: "$320",
      place: "East York", postedAt: Date.parse("2026-10-12T22:39:25.000Z"), lat: 43.7, lon: -79.31,
    });
  });
});

describe("karrot", () => {
  it("reads listings out of the page's Remix context, once each", () => {
    const item = {
      id: 11398318, nodeId: "tkt6hbsyqthj", title: "Ender 3 V2 3D Printer", price: "56",
      priceDescription: "$56 or trade", thumbnail: "https://img.karrot/x.jpg", status: "ongoing",
      relativeDistanceDescription: "23km", displayLocationName: "Bloor West Village",
    };
    const ctx = { state: { loaderData: { a: { list: [item, item, { ...item, nodeId: "sold1", status: "closed" }] } } } };
    const out = parseKarrot(`<script>window.__remixContext = ${JSON.stringify(ctx)};</script>`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "kr:tkt6hbsyqthj", price: "$56 or trade", place: "Bloor West Village", km: 23, postedAt: null,
      url: "https://www.karrotmarket.com/ca/buy-sell/tkt6hbsyqthj/",
    });
  });
});

describe("relevance", () => {
  it("keeps real matches and drops padding, prints and wanted posts", () => {
    const printers = search("printers");
    expect(relevant("Bambu Lab X1-Carbon (X1C) 3D Printer with AMS Combo", printers)).toBe(true);
    expect(relevant("Hot Wheels Storage Tower", printers)).toBe(false);
    expect(relevant("Fidget toy 3D printed", printers)).toBe(false);
    expect(relevant("Rongta Tattoo Stencil Printer F81S New", printers)).toBe(false);
    expect(relevant("looking for 3d printer. Willing to trade plants", printers)).toBe(false);

    const games = search("games");
    expect(relevant("Nintendo Switch OLED with 3 games", games)).toBe(true);
    expect(relevant("PS5 controller", games)).toBe(true);
    expect(relevant("Catan board game", games)).toBe(false);

    const filament = search("filament");
    expect(relevant("SUNLU PLA+ Filament 1.75mm, Pink", filament)).toBe(true);
    expect(relevant("Plant stand", filament)).toBe(false);
  });

  it("survives a broken pattern typed into Settings", () => {
    expect(relevant("anything", { match: "([", exclude: "" })).toBe(true);
  });
});

describe("merging listings", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const l = (id: string, source: Listing["source"], postedAt: number | null): Listing => ({
    id, source, search: "games", title: id, price: "$1", place: "", image: null, url: "", postedAt, firstSeen: 0,
  });

  it("sorts newest first and remembers when each was first seen", () => {
    const first = mergeListings([], [l("a", "facebook", now - 60_000), l("b", "kijiji", now - 3_600_000)], now);
    expect(first.map((x) => x.id)).toEqual(["a", "b"]);
    const later = mergeListings(first, [l("a", "facebook", now - 60_000)], now + 600_000);
    expect(later.find((x) => x.id === "a")!.firstSeen).toBe(now);
  });

  it("does not call every undated listing new on the first look", () => {
    const first = mergeListings([], [l("k1", "karrot", null)], now);
    expect(listedAt(first[0])).toBe(now - 24 * 3_600_000);
    // A listing that turns up on a later look really is new.
    const later = mergeListings(first, [l("k2", "karrot", null)], now + 600_000);
    expect(listedAt(later.find((x) => x.id === "k2")!)).toBe(now + 600_000);
    expect(later[0].id).toBe("k2");
  });

  it("drops listings older than a week", () => {
    const out = mergeListings([], [l("old", "facebook", now - 8 * 24 * 3_600_000)], now);
    expect(out).toEqual([]);
  });
});

describe("balanced listing selection", () => {
  it("gives every search a share instead of letting the busiest fill the panel", async () => {
    const { balanceListings } = await import("../src/lib/sources/market");
    const mk = (search: string, i: number): Listing => ({
      id: `${search}${i}`, source: "kijiji", search, title: "", price: "", place: "", image: null, url: "",
      postedAt: 1_000_000 - i * (search === "games" ? 1 : 1000), firstSeen: 0,
    });
    const all = [...Array.from({ length: 50 }, (_, i) => mk("games", i)), ...Array.from({ length: 5 }, (_, i) => mk("filament", i))];
    const out = balanceListings(all, 10);
    expect(out.filter((l) => l.search === "filament").length).toBe(5);
    expect(out.length).toBe(10);
  });
});
