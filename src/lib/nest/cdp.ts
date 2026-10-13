/**
 * A very small Chrome DevTools Protocol client.
 *
 * Node 24 ships a global WebSocket, and the protocol is plain JSON, so driving
 * a browser needs no dependency at all — which matters here, where the whole
 * app deliberately avoids native modules.
 */

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

const endpoint = (port: number, path: string) => `http://127.0.0.1:${port}${path}`;

async function json<T>(url: string, init?: RequestInit, timeoutMs = 4000): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.text();
    return body ? (JSON.parse(body) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** True once the browser is up and answering on the debugging port. */
export async function debuggerReady(port: number): Promise<boolean> {
  return (await json<{ Browser?: string }>(endpoint(port, "/json/version"), undefined, 1500)) !== null;
}

/** The browser-wide endpoint, which is where `Browser.close` has to be sent. */
export async function browserSocket(port: number): Promise<string | null> {
  const v = await json<{ webSocketDebuggerUrl?: string }>(endpoint(port, "/json/version"), undefined, 1500);
  return v?.webSocketDebuggerUrl ?? null;
}

export async function listTargets(port: number): Promise<CdpTarget[]> {
  const list = await json<CdpTarget[]>(endpoint(port, "/json/list"));
  return Array.isArray(list) ? list.filter((t) => t.type === "page") : [];
}

/** Chrome has required PUT (not GET) for /json/new since version 111. */
export async function openTab(port: number, url: string): Promise<CdpTarget | null> {
  return json<CdpTarget>(endpoint(port, `/json/new?${encodeURIComponent(url)}`), { method: "PUT" });
}

export async function closeTab(port: number, id: string): Promise<void> {
  await json(endpoint(port, `/json/close/${id}`));
}

/** Brings a tab to the front. A background tab may not paint a fresh frame. */
export async function activateTab(port: number, id: string): Promise<void> {
  await json(endpoint(port, `/json/activate/${id}`));
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpSession {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (typeof msg.id !== "number") return; // an event, not a reply
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? "cdp error"));
      else p.resolve(msg.result);
    };
    const fail = () => {
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("cdp socket closed"));
        this.pending.delete(id);
      }
    };
    ws.onclose = fail;
    ws.onerror = fail;
  }

  static open(wsUrl: string, timeoutMs = 8000): Promise<CdpSession> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("cannot open cdp socket"));
        return;
      }
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* already gone */
        }
        reject(new Error("cdp connect timed out"));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new CdpSession(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("cdp connect failed"));
      };
    });
  }

  send<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error("cdp send failed"));
      }
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}
