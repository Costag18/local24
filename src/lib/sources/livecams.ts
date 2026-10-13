import { BROWSER_UA, fetchText } from "../http";
import { getBlob, putBlob } from "../db";
import { loadConfig } from "../config";
import { parseChannelRef } from "../channels";

export interface CamStatus {
  id: string;
  live: boolean;
  /** False when YouTube refuses to play it inside an iframe. */
  embeddable: boolean;
  checkedAt: number;
}

/**
 * A YouTube watch page says whether the video is live right now and whether it
 * may be embedded. Both are plain flags in the page's JSON payload.
 */
export function readLiveFlags(html: string): { live: boolean; embeddable: boolean } {
  return {
    live: /"isLive":true/.test(html),
    embeddable: !/"playableInEmbed":false/.test(html),
  };
}

/**
 * Where to look to find out whether a source is on air.
 *
 * A video id has a watch page. A channel has a `/live` page, which redirects
 * to the stream when there is one and to the channel itself when there is not
 * — so the same flag works for both. A playlist has neither and is left alone.
 * Returns null for anything that cannot be checked.
 */
export function livenessUrl(ref: string): string | null {
  const parsed = parseChannelRef(ref);
  if (!parsed.embeddable) return null;
  if (/^UC[\w-]{20,}$/.test(parsed.ref)) {
    return `https://www.youtube.com/channel/${parsed.ref}/live`;
  }
  if (/^[\w-]{11}$/.test(parsed.ref)) {
    return `https://www.youtube.com/watch?v=${parsed.ref}`;
  }
  return null;
}

/**
 * Live streams end without warning — a cam that was live yesterday can be an
 * archive today, and an archive renders as a dead player with no explanation.
 * Checking periodically lets the panel skip what is no longer live and say so,
 * instead of cycling to a black rectangle.
 */
export async function ingestLiveCamStatus(): Promise<number> {
  const cfg = loadConfig();
  const out: CamStatus[] = [];

  for (const cam of cfg.videoCams) {
    const parsed = parseChannelRef(cam.ref);
    const url = livenessUrl(cam.ref);

    // A playlist, a handle, anything unrecognised: assumed fine rather than
    // wrongly hidden.
    if (!url) {
      out.push({ id: cam.id, live: true, embeddable: parsed.embeddable, checkedAt: Date.now() });
      continue;
    }

    // A browser user agent is required here; ours gets a stub page.
    const html = await fetchText("livecams.check", url, 25000, BROWSER_UA);
    if (html === null) {
      // A failed check must not blank a working camera.
      out.push({ id: cam.id, live: true, embeddable: true, checkedAt: Date.now() });
      continue;
    }

    // A short body means a stub, not an ended stream — do not hide the cam.
    if (html.length < 20_000) {
      out.push({ id: cam.id, live: true, embeddable: true, checkedAt: Date.now() });
      continue;
    }

    const flags = readLiveFlags(html);
    out.push({ id: cam.id, ...flags, checkedAt: Date.now() });

    // Back-to-back watch-page requests earn a 429; these checks are not urgent.
    await new Promise((r) => setTimeout(r, 4000));
  }

  putBlob("livecams.status", out);
  return out.filter((c) => c.live).length;
}

export function getLiveCamStatus(): CamStatus[] {
  return getBlob<CamStatus[]>("livecams.status")?.value ?? [];
}
