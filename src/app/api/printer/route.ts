import { NextResponse } from "next/server";
import { printerView } from "@/lib/printer";

export const dynamic = "force-dynamic";

/** Print progress and temperatures; polled by the printer page while it shows. */
export async function GET() {
  return NextResponse.json(printerView());
}
