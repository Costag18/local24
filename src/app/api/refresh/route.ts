import { NextResponse } from "next/server";
import { JOBS, runNow, setBatteryState } from "@/lib/poller";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { job?: string; onBattery?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body means "refresh everything" */
  }

  if (typeof body.onBattery === "boolean") setBatteryState(body.onBattery);

  // The battery hook posts `job: "none"` purely to report its state; treating
  // that as an unknown job answered every page load with a 404.
  if (body.job === "none") return NextResponse.json({ ok: true });

  if (!body.job || body.job === "all") {
    const results = await Promise.all(JOBS.map(async (j) => [j.id, await runNow(j.id)] as const));
    return NextResponse.json({ ok: true, results: Object.fromEntries(results) });
  }

  const ok = await runNow(body.job);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
