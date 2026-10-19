import { NextResponse } from "next/server";
import { getBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

/** The next-buses board; see lib/board.ts. Shared with the TV page. */
export async function GET() {
  return NextResponse.json(await getBoard());
}
