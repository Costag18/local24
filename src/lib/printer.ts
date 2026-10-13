import tls from "node:tls";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";

/**
 * A Bambu Lab printer on the local network.
 *
 * Status comes over the printer's own MQTT broker (TLS, port 8883, user
 * `bblp`, the LAN access code as password): it publishes a report on
 * `device/<serial>/report`, a full one when asked with `pushall` and partial
 * updates after that, which are merged into one picture here.
 *
 * The camera depends on the model and on a setting on the printer:
 *   - P1/A1-class printers stream JPEG frames over TLS on port 6000 once a
 *     login packet is sent;
 *   - 1080p models publish an RTSPS URL (port 322) instead, which a browser
 *     cannot play, so ffmpeg turns it into JPEGs when it is installed.
 * Both need "LAN Only Liveview" switched on at the printer; until it is, the
 * report says `rtsp_url: "disable"` and port 6000 answers with an error.
 *
 * Nothing connects until the dashboard asks, and everything disconnects once
 * it stops asking: the printer accepts only a handful of LAN clients, and the
 * slicer needs one of them.
 */

export interface PrinterStatus {
  /** IDLE, PREPARE, RUNNING, PAUSE, FINISH, FAILED — as the printer reports. */
  state: string;
  percent: number | null;
  remainingMin: number | null;
  layer: number | null;
  totalLayers: number | null;
  file: string;
  nozzle: number | null;
  nozzleTarget: number | null;
  bed: number | null;
  bedTarget: number | null;
  /** Non-zero when the printer is reporting a fault. */
  errorCode: number;
  /** What is loaded in the AMS, slot by slot. Empty when there is no AMS. */
  trays: Tray[];
  /** Inside the AMS, as relative humidity %; filament wants it dry. */
  amsHumidity: number | null;
  at: number;
}

export interface Tray {
  /** "A1".."A4" for the first AMS, "B1".. for a second. */
  slot: string;
  /** PLA, PETG… Empty for an empty slot. */
  type: string;
  /** "PLA Basic" on a Bambu spool; blank on third-party ones. */
  name: string;
  /** CSS colour. */
  color: string;
  /** Percent left, or null when the spool has no chip to say. */
  remain: number | null;
  /** The slot feeding the printer right now. */
  active: boolean;
}

/** The AMS block of a report, as one flat list of slots. Pure. */
export function readTrays(p: Record<string, unknown>): { trays: Tray[]; humidity: number | null } {
  const ams = p.ams as { ams?: unknown; tray_now?: unknown } | undefined;
  const units = Array.isArray(ams?.ams) ? (ams.ams as Record<string, unknown>[]) : [];
  const now = Number(ams?.tray_now);
  const trays: Tray[] = [];
  let humidity: number | null = null;
  for (const unit of units) {
    const u = Number(unit.id ?? 0);
    const raw = Number(unit.humidity_raw);
    if (humidity === null && Number.isFinite(raw) && raw > 0) humidity = raw;
    const list = Array.isArray(unit.tray) ? (unit.tray as Record<string, unknown>[]) : [];
    for (const t of list) {
      const i = Number(t.id ?? 0);
      const hex = typeof t.tray_color === "string" ? t.tray_color.slice(0, 6) : "";
      const remain = Number(t.remain);
      trays.push({
        slot: `${String.fromCharCode(65 + u)}${i + 1}`,
        type: typeof t.tray_type === "string" ? t.tray_type : "",
        name: typeof t.tray_sub_brands === "string" ? t.tray_sub_brands : "",
        color: /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : "transparent",
        remain: Number.isFinite(remain) && remain >= 0 ? remain : null,
        active: u * 4 + i === now,
      });
    }
  }
  return { trays, humidity };
}

export type CameraState =
  | "off"
  | "connecting"
  | "streaming"
  /** The printer refused: LAN Only Liveview is switched off on it. */
  | "liveview-off"
  /** RTSP is on, but there is no ffmpeg to turn it into pictures. */
  | "needs-ffmpeg"
  | "error";

export interface PrinterView {
  configured: boolean;
  connected: boolean;
  status: PrinterStatus | null;
  camera: CameraState;
  cameraAt: number;
  error: string | null;
  /** When the last print finished or failed while we were watching. */
  endedAt: number;
}

/** Stop talking to the printer this long after the dashboard last asked. */
const IDLE_MS = 45_000;
/** Wait this long before retrying a refused or dropped connection. */
const RETRY_MS = 30_000;

interface Hub {
  mqtt: tls.TLSSocket | null;
  mqttRetryAt: number;
  report: Record<string, unknown>;
  status: PrinterStatus | null;
  connected: boolean;
  error: string | null;
  endedAt: number;
  lastAsked: number;
  pinger: ReturnType<typeof setInterval> | null;

  cam: tls.TLSSocket | null;
  ffmpeg: ChildProcess | null;
  camState: CameraState;
  camRetryAt: number;
  frame: Buffer | null;
  frameAt: number;
  camAsked: number;
  idler: ReturnType<typeof setInterval> | null;
}

// On globalThis: Next gives each route its own copy of this module in dev,
// and two copies would each open their own connections to the printer.
const g = globalThis as unknown as { __local24Printer?: Hub };
const hub: Hub = (g.__local24Printer ??= {
  mqtt: null, mqttRetryAt: 0, report: {}, status: null, connected: false, error: null, endedAt: 0,
  lastAsked: 0, pinger: null,
  cam: null, ffmpeg: null, camState: "off", camRetryAt: 0, frame: null, frameAt: 0, camAsked: 0,
  idler: null,
});

function settings() {
  const p = loadConfig().printer;
  return p.host && p.serial && p.accessCode ? p : null;
}

// --- MQTT, the minimum of it ------------------------------------------------

function mqttString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}

function varint(n: number): Buffer {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 128;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}

function mqttPacket(type: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([type]), varint(body.length), body]);
}

/**
 * Splits MQTT packets off the front of a buffer. Returns the packets found and
 * whatever is left over (an incomplete packet waiting for more bytes). Pure.
 */
export function readPackets(buf: Buffer): { packets: { type: number; body: Buffer }[]; rest: Buffer } {
  const packets: { type: number; body: Buffer }[] = [];
  let off = 0;
  while (buf.length - off >= 2) {
    let mult = 1;
    let len = 0;
    let i = off + 1;
    let byte = 0;
    do {
      if (i >= buf.length) return { packets, rest: buf.subarray(off) };
      byte = buf[i++];
      len += (byte & 127) * mult;
      mult *= 128;
    } while (byte & 128);
    if (buf.length < i + len) break;
    packets.push({ type: buf[off] >> 4, body: buf.subarray(i, i + len) });
    off = i + len;
  }
  return { packets, rest: buf.subarray(off) };
}

/** Partial reports only carry what changed; fold them into the full picture. */
export function mergeReport(into: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(patch)) {
    const cur = into[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      mergeReport(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      into[k] = v;
    }
  }
  return into;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The handful of fields worth showing, out of the ~100 the printer sends. */
export function summarize(p: Record<string, unknown>, at = Date.now()): PrinterStatus {
  return {
    state: typeof p.gcode_state === "string" ? p.gcode_state : "UNKNOWN",
    percent: num(p.mc_percent),
    remainingMin: num(p.mc_remaining_time),
    layer: num(p.layer_num),
    totalLayers: num(p.total_layer_num),
    file: typeof p.subtask_name === "string" ? p.subtask_name : "",
    nozzle: num(p.nozzle_temper),
    nozzleTarget: num(p.nozzle_target_temper),
    bed: num(p.bed_temper),
    bedTarget: num(p.bed_target_temper),
    errorCode: num(p.print_error) ?? 0,
    trays: readTrays(p).trays,
    amsHumidity: readTrays(p).humidity,
    at,
  };
}

function rtspUrl(): string | null {
  const cam = hub.report.ipcam as { rtsp_url?: unknown } | undefined;
  const url = typeof cam?.rtsp_url === "string" ? cam.rtsp_url : "";
  return /^rtsps?:\/\//i.test(url) ? url : null;
}

function connectMqtt(): void {
  const p = settings();
  if (!p || hub.mqtt || Date.now() < hub.mqttRetryAt) return;

  const sock = tls.connect({ host: p.host, port: 8883, rejectUnauthorized: false, timeout: 10_000 });
  hub.mqtt = sock;
  let buf: Buffer = Buffer.alloc(0);

  sock.on("secureConnect", () => {
    const body = Buffer.concat([
      mqttString("MQTT"), Buffer.from([4, 0xc2, 0, 60]),
      mqttString(`local24-${process.pid}`), mqttString("bblp"), mqttString(p.accessCode),
    ]);
    sock.write(mqttPacket(0x10, body));
  });

  sock.on("data", (d) => {
    const { packets, rest } = readPackets(Buffer.concat([buf, d]));
    buf = rest;
    for (const pk of packets) {
      if (pk.type === 2) {
        if (pk.body[1] !== 0) {
          hub.error = pk.body[1] === 5 ? "access code refused" : `login refused (${pk.body[1]})`;
          sock.destroy();
          return;
        }
        hub.connected = true;
        hub.error = null;
        sock.write(mqttPacket(0x82, Buffer.concat([
          Buffer.from([0, 1]), mqttString(`device/${p.serial}/report`), Buffer.from([0]),
        ])));
        const ask = JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } });
        sock.write(mqttPacket(0x30, Buffer.concat([mqttString(`device/${p.serial}/request`), Buffer.from(ask)])));
      } else if (pk.type === 3) {
        const topicLen = pk.body.readUInt16BE(0);
        try {
          const msg = JSON.parse(pk.body.subarray(2 + topicLen).toString("utf8")) as { print?: Record<string, unknown> };
          if (msg.print) {
            const before = hub.status?.state;
            mergeReport(hub.report, msg.print);
            hub.status = summarize(hub.report);
            // A print ending is worth a moment's notice on screen.
            const after = hub.status.state;
            if (before && before !== after && (after === "FINISH" || after === "FAILED")) hub.endedAt = Date.now();
          }
        } catch {
          /* not every message is a report */
        }
      }
    }
  });

  hub.pinger ??= setInterval(() => hub.mqtt?.write(Buffer.from([0xc0, 0])), 30_000);

  const down = (why?: string) => {
    if (hub.mqtt !== sock) return;
    hub.mqtt = null;
    hub.connected = false;
    if (why) hub.error = why;
    hub.mqttRetryAt = Date.now() + RETRY_MS;
  };
  sock.on("timeout", () => sock.destroy());
  sock.on("error", (e) => down(e.message));
  sock.on("close", () => down());
}

// --- camera -----------------------------------------------------------------

function onFrame(jpg: Buffer): void {
  hub.frame = jpg;
  hub.frameAt = Date.now();
  hub.camState = "streaming";
}

/** P1/A1-class: a login packet, then length-prefixed JPEGs. */
function connectPort6000(p: { host: string; accessCode: string }): void {
  const sock = tls.connect({ host: p.host, port: 6000, rejectUnauthorized: false, timeout: 10_000 });
  hub.cam = sock;
  hub.camState = "connecting";
  let buf: Buffer = Buffer.alloc(0);

  sock.on("secureConnect", () => {
    const auth = Buffer.alloc(80);
    auth.writeUInt32LE(0x40, 0);
    auth.writeUInt32LE(0x3000, 4);
    auth.write("bblp", 16, "ascii");
    auth.write(p.accessCode, 48, "ascii");
    sock.write(auth);
  });

  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 16) {
      const size = buf.readUInt32LE(0);
      if (size > 8_000_000) {
        sock.destroy();
        return;
      }
      if (buf.length < 16 + size) break;
      const payload = buf.subarray(16, 16 + size);
      buf = buf.subarray(16 + size);
      if (payload[0] === 0xff && payload[1] === 0xd8) {
        onFrame(Buffer.from(payload));
      } else {
        // A short non-image reply is the printer turning the login down.
        hub.camState = "liveview-off";
        hub.camRetryAt = Date.now() + RETRY_MS * 2;
        sock.destroy();
        return;
      }
    }
  });

  const down = () => {
    if (hub.cam !== sock) return;
    hub.cam = null;
    if (hub.camState === "streaming" || hub.camState === "connecting") hub.camState = "error";
    hub.camRetryAt = Math.max(hub.camRetryAt, Date.now() + 5_000);
  };
  sock.on("timeout", () => sock.destroy());
  sock.on("error", down);
  sock.on("close", down);
}

function findFfmpeg(): string | null {
  const local = path.resolve(process.cwd(), "tools/ffmpeg/ffmpeg.exe");
  if (existsSync(local)) return local;
  // Where `winget install` puts it. Looked up directly because a server that
  // was already running keeps the PATH it started with, and winget adds the
  // package's own folder to PATH rather than always linking it.
  const appData = process.env.LOCALAPPDATA;
  if (appData) {
    const link = path.join(appData, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
    if (existsSync(link)) return link;
    const packages = path.join(appData, "Microsoft", "WinGet", "Packages");
    try {
      for (const pkg of readdirSync(packages).filter((d) => /^Gyan\.FFmpeg/i.test(d))) {
        for (const build of readdirSync(path.join(packages, pkg))) {
          const exe = path.join(packages, pkg, build, "bin", "ffmpeg.exe");
          if (existsSync(exe)) return exe;
        }
      }
    } catch {
      /* no winget packages folder */
    }
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const exe = path.join(dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (dir && existsSync(exe)) return exe;
  }
  return null;
}

/** 1080p models: RTSPS through ffmpeg, a few JPEGs a second out of its stdout. */
function connectRtsp(url: string, p: { accessCode: string }): void {
  const exe = findFfmpeg();
  if (!exe) {
    hub.camState = "needs-ffmpeg";
    hub.camRetryAt = Date.now() + RETRY_MS * 2;
    return;
  }
  const authed = url.replace(/^(rtsps?:\/\/)(?:[^@/]*@)?/i, `$1bblp:${encodeURIComponent(p.accessCode)}@`);
  const ff = spawn(exe, [
    // The printer's certificate is signed by Bambu's own device CA, which no
    // system trusts; ffmpeg 9 refuses it unless told not to verify. The
    // status connection makes the same choice for the same reason.
    "-loglevel", "error", "-tls_verify", "0", "-rtsp_transport", "tcp", "-i", authed,
    "-vf", "fps=4,scale=1280:-2", "-q:v", "6", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
  ], { windowsHide: true });
  hub.ffmpeg = ff;
  hub.camState = "connecting";
  let buf: Buffer = Buffer.alloc(0);
  ff.stdout.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const start = buf.indexOf(Buffer.from([0xff, 0xd8]));
      const end = start === -1 ? -1 : buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (start === -1 || end === -1) break;
      onFrame(Buffer.from(buf.subarray(start, end + 2)));
      buf = buf.subarray(end + 2);
    }
    if (buf.length > 8_000_000) buf = Buffer.alloc(0);
  });
  ff.on("exit", () => {
    if (hub.ffmpeg !== ff) return;
    hub.ffmpeg = null;
    if (hub.camState !== "needs-ffmpeg") hub.camState = "error";
    hub.camRetryAt = Date.now() + 5_000;
  });
}

function connectCamera(): void {
  const p = settings();
  if (!p || hub.cam || hub.ffmpeg || Date.now() < hub.camRetryAt) return;
  const url = rtspUrl();
  if (url) connectRtsp(url, p);
  else connectPort6000(p);
}

function stopCamera(): void {
  hub.cam?.destroy();
  hub.cam = null;
  hub.ffmpeg?.kill();
  hub.ffmpeg = null;
  if (hub.camState === "streaming" || hub.camState === "connecting") hub.camState = "off";
}

/** Hangs up on the printer once nobody is watching. */
function ensureIdler(): void {
  hub.idler ??= setInterval(() => {
    const now = Date.now();
    if (now - hub.camAsked > IDLE_MS) stopCamera();
    if (now - hub.lastAsked > IDLE_MS && hub.mqtt) {
      hub.mqtt.destroy();
      hub.mqtt = null;
      hub.connected = false;
      hub.mqttRetryAt = 0;
    }
  }, 10_000);
}

// --- what the routes call ---------------------------------------------------

export function printerView(): PrinterView {
  hub.lastAsked = Date.now();
  ensureIdler();
  connectMqtt();
  return {
    configured: Boolean(settings()),
    connected: hub.connected,
    status: hub.status,
    camera: hub.camState,
    cameraAt: hub.frameAt,
    error: hub.error,
    endedAt: hub.endedAt,
  };
}

export function printerFrame(): { jpg: Buffer | null; at: number; state: CameraState } {
  hub.lastAsked = hub.camAsked = Date.now();
  ensureIdler();
  connectMqtt();
  connectCamera();
  return { jpg: hub.frame, at: hub.frameAt, state: hub.camState };
}
