import { NextResponse } from "next/server";
import { searchItems } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ q, results: searchItems(q, 60) });
}
