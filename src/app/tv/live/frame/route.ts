import { mirrorFrame } from "@/lib/mirror";

export const dynamic = "force-dynamic";

/** One picture of the real dashboard, for /tv/live. See lib/mirror.ts. */
export async function GET() {
  const { jpg, error } = await mirrorFrame();
  if (!jpg) return new Response(error ?? "no picture yet", { status: 503, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(jpg), {
    headers: { "content-type": "image/jpeg", "cache-control": "no-store, no-cache, must-revalidate", pragma: "no-cache" },
  });
}
