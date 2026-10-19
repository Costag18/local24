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
