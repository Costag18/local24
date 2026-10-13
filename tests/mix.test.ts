import { describe, expect, it } from "vitest";
import { embedUrl, interleave, mixEmbedUrl, mixSources, parseChannelRef, playlistIds, watchUrl } from "../src/lib/channels";

const UC = "UCsrAdYJzB20KmtJtN7hB8nQ";
const PL = "PL6ZkL6WewfuH1f-EJ96lp7WG8weMLiG1x";

describe("mixed channels", () => {
  it("reads a channel plus a playlist as a mix", () => {
    expect(mixSources(`${UC}, ${PL}`)).toEqual([UC, PL]);
  });

  it("leaves a single source alone", () => {
    expect(mixSources(UC)).toBeNull();
    expect(mixSources(PL)).toBeNull();
  });

  it("rejects anything that is not an id", () => {
    expect(mixSources(`${UC}, https://example.com`)).toBeNull();
  });

  it("is embeddable but has no single embed URL — the server resolves it", () => {
    const ch = { id: "m", label: "Mix", type: "youtube" as const, ref: `${UC},${PL}` };
    expect(parseChannelRef(ch.ref).embeddable).toBe(true);
    expect(embedUrl(ch)).toBeNull();
    expect(watchUrl(ch)).toBe(`https://www.youtube.com/channel/${UC}/videos`);
  });

  it("alternates between sources and never repeats a video", () => {
    const out = interleave([["a1", "a2", "a3"], ["b1", "b2"]], 10, () => 0.999);
    expect(out).toHaveLength(5);
    expect(new Set(out).size).toBe(5);
    expect(out.slice(0, 4).map((v) => v[0])).toEqual(["a", "b", "a", "b"]);
  });

  it("stops at the limit", () => {
    expect(interleave([["a", "b", "c"], ["d", "e", "f"]], 4)).toHaveLength(4);
  });

  it("plays the merged list as a looping playlist", () => {
    const url = mixEmbedUrl(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(url).toContain("/embed/aaaaaaaaaaa?");
    expect(url).toContain("playlist=aaaaaaaaaaa,bbbbbbbbbbb");
    expect(mixEmbedUrl([])).toBeNull();
  });

  it("reads video ids from both playlist page formats", () => {
    const html =
      '{"lockupViewModel":{"contentId":"8a_KN0pJbuc"}}' +
      '{"playlistVideoRenderer":{"videoId":"Kzk_vg4maOg"}}' +
      '{"contentId":"8a_KN0pJbuc"}';
    expect(playlistIds(html)).toEqual(["8a_KN0pJbuc", "Kzk_vg4maOg"]);
  });
});
