import { describe, expect, it } from "vitest";
import { mjpegResponse } from "../src/lib/mjpeg";

describe("MJPEG streams", () => {
  it("sends each new frame once, as a multipart part", async () => {
    let n = 0;
    const frames = [Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]), Buffer.from([0xff, 0xd8, 2, 0xff, 0xd9])];
    const ctrl = new AbortController();
    const res = mjpegResponse(new Request("http://x/", { signal: ctrl.signal }), {
      fps: 200,
      // The same frame twice, then a new one: the repeat must not be resent.
      next: () => {
        const i = Math.min(1, Math.floor(n++ / 2));
        return { jpg: frames[i], at: i + 1 };
      },
    });
    expect(res.headers.get("content-type")).toBe("multipart/x-mixed-replace; boundary=local24frame");
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    while (chunks.length < 6) chunks.push((await reader.read()).value!);
    ctrl.abort();
    await reader.cancel();
    const text = Buffer.concat(chunks).toString("latin1");
    expect(text.match(/--local24frame/g)).toHaveLength(2);
    expect(text).toContain("Content-Type: image/jpeg\r\nContent-Length: 5\r\n\r\n");
  });
});

describe("MJPEG backpressure", () => {
  it("stops taking frames while a slow viewer has not read the last ones", async () => {
    let calls = 0;
    const big = Buffer.alloc(200 * 1024, 7);
    const ctrl = new AbortController();
    const res = mjpegResponse(new Request("http://x/", { signal: ctrl.signal }), {
      fps: 200,
      next: () => ({ jpg: big, at: ++calls }),
    });
    // Nobody reads for a while: frames must be skipped, not piled up.
    await new Promise((r) => setTimeout(r, 300));
    ctrl.abort();
    await res.body!.cancel();
    expect(calls).toBeLessThanOrEqual(3);
  });

  it("refuses streams past the cap instead of opening without limit", () => {
    const ctrls: AbortController[] = [];
    const responses: Response[] = [];
    for (let i = 0; i < 13; i++) {
      const c = new AbortController();
      ctrls.push(c);
      responses.push(mjpegResponse(new Request("http://x/", { signal: c.signal }), { fps: 1, next: () => ({ jpg: null, at: 0 }) }));
    }
    expect(responses.slice(0, 12).every((r) => r.status === 200)).toBe(true);
    expect(responses[12].status).toBe(503);
    for (const c of ctrls) c.abort();
    // Closed streams free their slots.
    const again = mjpegResponse(new Request("http://x/"), { fps: 1, next: () => ({ jpg: null, at: 0 }) });
    expect(again.status).toBe(200);
    void again.body?.cancel();
  });
});

describe("MJPEG stalled viewers", () => {
  it("drops a viewer that stops reading, freeing its place", async () => {
    let calls = 0;
    const big = Buffer.alloc(200 * 1024, 7);
    const res = mjpegResponse(new Request("http://x/"), {
      fps: 200,
      stallMs: 150,
      next: () => ({ jpg: big, at: ++calls }),
    });
    await new Promise((r) => setTimeout(r, 400));
    // The stream has errored out; reading it now fails instead of hanging.
    const reader = res.body!.getReader();
    let failed = false;
    try {
      for (let i = 0; i < 10; i++) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
