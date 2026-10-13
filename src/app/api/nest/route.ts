import { NextResponse } from "next/server";
import { nestStatus, startBridge, startSignIn, stopBridge } from "@/lib/nest/bridge";

export const dynamic = "force-dynamic";

/** Control panel for the Google Home capture bridge. */
export async function GET() {
  return NextResponse.json(nestStatus());
}

export async function POST(req: Request) {
  let body: { action?: string; hidden?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body is treated as a status read */
  }

  switch (body.action) {
    case "signin":
      return NextResponse.json({ ...startSignIn(), status: nestStatus() });
    case "start": {
      const out = await startBridge(body.hidden !== false);
      return NextResponse.json({ ...out, status: nestStatus() });
    }
    case "stop":
      await stopBridge();
      return NextResponse.json({ ok: true, status: nestStatus() });
    default:
      return NextResponse.json(nestStatus());
  }
}
