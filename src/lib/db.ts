import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Camera, Item, SourceHealth } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "local24.db");

let db: DatabaseSync | null = null;

/** Each statement is run individually so schema changes stay reviewable. */
const SCHEMA: string[] = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  `CREATE TABLE IF NOT EXISTS items (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     sourceId TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL DEFAULT '',
     link TEXT NOT NULL DEFAULT '',
     published INTEGER NOT NULL,
     fetched INTEGER NOT NULL,
     weight REAL NOT NULL DEFAULT 1,
     meta TEXT NOT NULL DEFAULT '{}'
   )`,
  "CREATE INDEX IF NOT EXISTS items_kind_pub ON items(kind, published DESC)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(id UNINDEXED, title, body, tokenize='porter')",
  `CREATE TABLE IF NOT EXISTS cams (
     id TEXT PRIMARY KEY,
     network TEXT NOT NULL,
     label TEXT NOT NULL,
     roadway TEXT NOT NULL DEFAULT '',
     cross_street TEXT NOT NULL DEFAULT '',
     lat REAL NOT NULL,
     lon REAL NOT NULL,
     imageUrl TEXT NOT NULL,
     dead INTEGER NOT NULL DEFAULT 0,
     lastFrameHash TEXT,
     lastOk INTEGER
   )`,
  // Ring buffer for camera scrub-back. Identical frames are not re-stored.
  `CREATE TABLE IF NOT EXISTS cam_frames (
     camId TEXT NOT NULL,
     at INTEGER NOT NULL,
     hash TEXT NOT NULL,
     bytes BLOB NOT NULL,
     PRIMARY KEY (camId, at)
   )`,
  `CREATE TABLE IF NOT EXISTS source_health (
     sourceId TEXT PRIMARY KEY,
     lastAttempt INTEGER,
     lastSuccess INTEGER,
     lastError TEXT,
     consecutiveFailures INTEGER NOT NULL DEFAULT 0,
     latencyMs INTEGER,
     bytes INTEGER NOT NULL DEFAULT 0
   )`,
  // Arbitrary JSON keyed by name: weather, fight cards, traffic snapshots.
  `CREATE TABLE IF NOT EXISTS blobs (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     at INTEGER NOT NULL
   )`,
];

/**
 * node:sqlite is built into Node 24 and ships FTS5, so there is no native
 * build step. Next dev reloads modules, hence the module-level singleton.
 */
export function getDb(): DatabaseSync {
  if (db) return db;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const next = new DatabaseSync(DB_PATH);
  for (const stmt of SCHEMA) next.prepare(stmt).run();
  db = next;
  return db;
}

/** Wraps a unit of work in a transaction, rolling back on throw. */
function tx<T>(fn: (d: DatabaseSync) => T): T {
  const d = getDb();
  d.prepare("BEGIN").run();
  try {
    const out = fn(d);
    d.prepare("COMMIT").run();
    return out;
  } catch (err) {
    try {
      d.prepare("ROLLBACK").run();
    } catch {
      /* rollback of an already-aborted tx is not itself an error */
    }
    throw err;
  }
}

// --- blobs -----------------------------------------------------------------

export function putBlob(key: string, value: unknown): void {
  getDb()
    .prepare(
      "INSERT INTO blobs(key,value,at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, at=excluded.at",
    )
    .run(key, JSON.stringify(value), Date.now());
}

export function getBlob<T>(key: string): { value: T; at: number } | null {
  const row = getDb().prepare("SELECT value, at FROM blobs WHERE key = ?").get(key) as
    | { value: string; at: number }
    | undefined;
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, at: row.at };
  } catch {
    return null;
  }
}

// --- items -----------------------------------------------------------------

export function upsertItems(items: Item[]): number {
  if (!items.length) return 0;
  return tx((d) => {
    const ins = d.prepare(`
      INSERT INTO items(id,kind,sourceId,title,body,link,published,fetched,weight,meta)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, body=excluded.body, weight=excluded.weight,
        fetched=excluded.fetched, meta=excluded.meta
    `);
    const fts = d.prepare("INSERT INTO items_fts(id,title,body) VALUES(?,?,?)");
    const seen = d.prepare("SELECT 1 FROM items WHERE id = ?");
    let added = 0;
    for (const it of items) {
      const isNew = !seen.get(it.id);
      ins.run(it.id, it.kind, it.sourceId, it.title, it.body, it.link,
        it.published, it.fetched, it.weight, JSON.stringify(it.meta));
      if (isNew) {
        fts.run(it.id, it.title, it.body);
        added++;
      }
    }
    return added;
  });
}

/** Halving roughly every six hours, the same curve the scorer uses. */
const DECAY_MS = 6 * 60 * 60 * 1000;

/**
 * `decay` ranks by freshness as well as weight.
 *
 * A row's stored weight is fixed when it is ingested, so without this an old
 * headline that scored well keeps outranking everything published since —
 * which left a month of Apple-event stories sitting at the top of the tech
 * panel. The decay is applied here, against the clock, rather than baked into
 * the stored value.
 */
export function listItems(kinds: string[], limit = 40, decay = false): Item[] {
  if (!kinds.length) return [];
  const marks = kinds.map(() => "?").join(",");
  const order = decay
    ? `weight / (1.0 + MAX(0.0, ? - published) / ${DECAY_MS}.0) DESC, published DESC`
    : "weight DESC, published DESC";
  const args = decay ? [...kinds, Date.now(), limit] : [...kinds, limit];
  const rows = getDb()
    .prepare(`SELECT * FROM items WHERE kind IN (${marks}) ORDER BY ${order} LIMIT ?`)
    .all(...args) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

export function searchItems(query: string, limit = 50): Item[] {
  if (!query.trim()) return [];
  try {
    const rows = getDb()
      .prepare(`
        SELECT i.* FROM items_fts f
        JOIN items i ON i.id = f.id
        WHERE items_fts MATCH ?
        ORDER BY i.published DESC LIMIT ?
      `)
      .all(query, limit) as Record<string, unknown>[];
    return rows.map(rowToItem);
  } catch {
    return []; // malformed FTS query — an empty result beats a 500
  }
}

function rowToItem(r: Record<string, unknown>): Item {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(r.meta ?? "{}"));
  } catch {
    /* keep {} */
  }
  return {
    id: String(r.id), kind: r.kind as Item["kind"], sourceId: String(r.sourceId),
    title: String(r.title), body: String(r.body), link: String(r.link),
    published: Number(r.published), fetched: Number(r.fetched),
    weight: Number(r.weight), meta,
  };
}

/**
 * Replaces every row of a kind with a fresh set, in one transaction.
 * Alerts are cleared and filters get tightened, so accumulating rows would
 * leave stale or since-excluded entries on screen indefinitely.
 */
export function replaceItemsOfKind(kind: string, items: Item[]): number {
  return tx((d) => {
    d.prepare("DELETE FROM items_fts WHERE id IN (SELECT id FROM items WHERE kind = ?)").run(kind);
    d.prepare("DELETE FROM items WHERE kind = ?").run(kind);
    const ins = d.prepare(`
      INSERT INTO items(id,kind,sourceId,title,body,link,published,fetched,weight,meta)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, body=excluded.body, weight=excluded.weight,
        fetched=excluded.fetched, meta=excluded.meta
    `);
    const fts = d.prepare("INSERT INTO items_fts(id,title,body) VALUES(?,?,?)");
    for (const it of items) {
      ins.run(it.id, it.kind, it.sourceId, it.title, it.body, it.link,
        it.published, it.fetched, it.weight, JSON.stringify(it.meta));
      fts.run(it.id, it.title, it.body);
    }
    return items.length;
  });
}

/**
 * Removes rows belonging to sources that are no longer configured.
 *
 * Items are upserted rather than replaced, so dropping a feed from the config
 * would otherwise leave its headlines on screen until they aged out days later.
 */
export function pruneOrphanSources(kind: string, activeSourceIds: string[]): number {
  const d = getDb();
  if (!activeSourceIds.length) return 0;
  const marks = activeSourceIds.map(() => "?").join(",");
  const doomed = d
    .prepare(`SELECT id FROM items WHERE kind = ? AND sourceId NOT IN (${marks})`)
    .all(kind, ...activeSourceIds) as { id: string }[];
  if (!doomed.length) return 0;
  return tx((db) => {
    const delFts = db.prepare("DELETE FROM items_fts WHERE id = ?");
    const delItem = db.prepare("DELETE FROM items WHERE id = ?");
    for (const row of doomed) {
      delFts.run(row.id);
      delItem.run(row.id);
    }
    return doomed.length;
  });
}

/** Keeps the DB from growing without bound on a machine that is always on. */
export function pruneItems(maxAgeDays = 14): void {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const d = getDb();
  d.prepare("DELETE FROM items_fts WHERE id IN (SELECT id FROM items WHERE published < ?)").run(cutoff);
  d.prepare("DELETE FROM items WHERE published < ?").run(cutoff);
}

/**
 * Drops camera frames older than the rewind window.
 *
 * The ring buffer caps frames *per camera*, which is not enough: rotation walks
 * through the whole playlist, so every camera it visits leaves a full buffer
 * behind and the file grows without limit. Rewind only ever reaches back a few
 * minutes, so anything older is dead weight.
 */
export function pruneCamFrames(maxAgeMinutes = 15): number {
  const cutoff = Date.now() - maxAgeMinutes * 60_000;
  const d = getDb();
  const before = d.prepare("SELECT COUNT(*) AS n FROM cam_frames WHERE at < ?").get(cutoff) as { n: number };
  d.prepare("DELETE FROM cam_frames WHERE at < ?").run(cutoff);
  return before.n;
}

// --- cameras ---------------------------------------------------------------

export function upsertCams(cams: Camera[]): void {
  if (!cams.length) return;
  tx((d) => {
    const stmt = d.prepare(`
      INSERT INTO cams(id,network,label,roadway,cross_street,lat,lon,imageUrl,dead,lastFrameHash,lastOk)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        label=excluded.label, roadway=excluded.roadway, cross_street=excluded.cross_street,
        lat=excluded.lat, lon=excluded.lon, imageUrl=excluded.imageUrl
    `);
    for (const c of cams) {
      stmt.run(c.id, c.network, c.label, c.roadway, c.cross, c.lat, c.lon,
        c.imageUrl, c.dead ? 1 : 0, c.lastFrameHash, c.lastOk);
    }
  });
}

export function listCams(): Camera[] {
  const rows = getDb().prepare("SELECT * FROM cams ORDER BY roadway, label").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id), network: r.network as Camera["network"], label: String(r.label),
    roadway: String(r.roadway), cross: String(r.cross_street),
    lat: Number(r.lat), lon: Number(r.lon), imageUrl: String(r.imageUrl),
    dead: Number(r.dead) === 1,
    lastFrameHash: r.lastFrameHash === null ? null : String(r.lastFrameHash),
    lastOk: r.lastOk === null ? null : Number(r.lastOk),
  }));
}

/**
 * Clears the dead flag so flagged cameras re-enter rotation. Only the hero
 * camera is proxied, so without this a camera that blipped once would never be
 * fetched again and would be excluded permanently.
 */
export function reviveDeadCams(): number {
  const d = getDb();
  const before = d.prepare("SELECT COUNT(*) AS n FROM cams WHERE dead = 1").get() as { n: number };
  d.prepare("UPDATE cams SET dead = 0 WHERE dead = 1").run();
  return before.n;
}

export function markCam(id: string, dead: boolean, hash: string | null): void {
  getDb()
    .prepare("UPDATE cams SET dead = ?, lastFrameHash = ?, lastOk = ? WHERE id = ?")
    .run(dead ? 1 : 0, hash, dead ? null : Date.now(), id);
}

// --- source health ---------------------------------------------------------

export function noteAttempt(sourceId: string): void {
  getDb()
    .prepare(`
      INSERT INTO source_health(sourceId,lastAttempt) VALUES(?,?)
      ON CONFLICT(sourceId) DO UPDATE SET lastAttempt=excluded.lastAttempt
    `)
    .run(sourceId, Date.now());
}

export function noteSuccess(sourceId: string, latencyMs: number, bytes: number): void {
  const now = Date.now();
  getDb()
    .prepare(`
      INSERT INTO source_health(sourceId,lastAttempt,lastSuccess,lastError,consecutiveFailures,latencyMs,bytes)
      VALUES(?,?,?,NULL,0,?,?)
      ON CONFLICT(sourceId) DO UPDATE SET
        lastAttempt=excluded.lastAttempt, lastSuccess=excluded.lastSuccess,
        lastError=NULL, consecutiveFailures=0, latencyMs=excluded.latencyMs,
        bytes=source_health.bytes + excluded.bytes
    `)
    .run(sourceId, now, now, latencyMs, bytes);
}

export function noteFailure(sourceId: string, error: string): void {
  getDb()
    .prepare(`
      INSERT INTO source_health(sourceId,lastAttempt,lastError,consecutiveFailures)
      VALUES(?,?,?,1)
      ON CONFLICT(sourceId) DO UPDATE SET
        lastAttempt=excluded.lastAttempt, lastError=excluded.lastError,
        consecutiveFailures=source_health.consecutiveFailures + 1
    `)
    .run(sourceId, Date.now(), error.slice(0, 500));
}

/**
 * Forgets sources that stopped existing.
 *
 * A retired endpoint leaves its last failure in the table forever, so the
 * health page goes on reporting a red source that nothing is even trying any
 * more. Anything untouched for a week is gone — a live source is attempted far
 * more often than that.
 */
/**
 * Clears what removed features left in the database.
 *
 * Deals were taken out entirely, and streets moved off Overpass; their stored
 * rows and source-health entries would otherwise sit there (and the health
 * page would list dead sources).
 */
export function purgeRetired(): void {
  tx((d) => {
    d.prepare("DELETE FROM items_fts WHERE id IN (SELECT id FROM items WHERE kind = 'deal')").run();
    d.prepare("DELETE FROM items WHERE kind = 'deal'").run();
    d.prepare("DELETE FROM source_health WHERE sourceId LIKE 'deals.%'").run();
    // Streets moved from Overpass to the City's centreline; 511 closed its
    // API; Engadget was dropped from the news sources.
    d.prepare(
      "DELETE FROM source_health WHERE sourceId IN ('streets.osm','traffic.on511','cams.on511','news.engadget')",
    ).run();
  });
}

export function pruneStaleHealth(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  const res = getDb()
    .prepare("DELETE FROM source_health WHERE COALESCE(lastAttempt, 0) < ?")
    .run(cutoff);
  return Number(res.changes ?? 0);
}

export function listHealth(): SourceHealth[] {
  const rows = getDb().prepare("SELECT * FROM source_health ORDER BY sourceId").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    sourceId: String(r.sourceId),
    lastAttempt: r.lastAttempt === null ? null : Number(r.lastAttempt),
    lastSuccess: r.lastSuccess === null ? null : Number(r.lastSuccess),
    lastError: r.lastError === null ? null : String(r.lastError),
    consecutiveFailures: Number(r.consecutiveFailures),
    latencyMs: r.latencyMs === null ? null : Number(r.latencyMs),
    bytes: Number(r.bytes),
  }));
}
