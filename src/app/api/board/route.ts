import { NextResponse } from "next/server";
import { getBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

/** The next-buses board; see lib/board.ts. */
export async function GET() {
  return NextResponse.json(await getBoard());
}
