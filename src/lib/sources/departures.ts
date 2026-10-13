/**
 * Next arrivals at one stop, from the TTC's NextBus feed (the same one the
 * map's live buses come from).
 */
export interface Departure {
  /** Predicted arrival, epoch ms. */
  at: number;
  vehicle: string;
  /**
   * The bus is still finishing its previous trip, so the time is a schedule
   * estimate rather than a tracked position — shown as such.
   */
  scheduled: boolean;
}

interface Prediction {
  epochTime?: string;
  vehicle?: string;
  affectedByLayover?: string;
  dirTag?: string;
}

type OneOrMany<T> = T | T[] | undefined;
const many = <T,>(v: OneOrMany<T>): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * NextBus returns a single object where it means a list of one, and a stop
 * served in both directions carries one `direction` block per direction —
 * so everything is normalised to arrays, and only the wanted direction kept.
 */
export function parsePredictions(json: unknown, dirPrefix = ""): Departure[] {
  const root = (json as { predictions?: OneOrMany<{ direction?: OneOrMany<{ prediction?: OneOrMany<Prediction> }> }> })
    ?.predictions;
  const out: Departure[] = [];
  for (const p of many(root)) {
    for (const d of many(p.direction)) {
      for (const pr of many(d.prediction)) {
        if (dirPrefix && !(pr.dirTag ?? "").startsWith(dirPrefix)) continue;
        const at = Number(pr.epochTime);
        if (!Number.isFinite(at)) continue;
        out.push({ at, vehicle: pr.vehicle ?? "", scheduled: pr.affectedByLayover === "true" });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
