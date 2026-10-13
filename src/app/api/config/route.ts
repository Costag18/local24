import { NextResponse } from "next/server";
import { loadConfig, patchConfig, publicConfig, saveConfig } from "@/lib/config";
import { DEFAULT_CONFIG } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(publicConfig(loadConfig()));
}

/** PATCH semantics: a partial object is deep-merged over the current config. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body && body.__reset === true) return NextResponse.json(publicConfig(saveConfig(DEFAULT_CONFIG)));
    return NextResponse.json(publicConfig(patchConfig(body)));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad request" },
      { status: 400 },
    );
  }
}
