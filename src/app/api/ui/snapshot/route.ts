import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Live data for the dashboard. Protected by the dashboard password in middleware. */
export async function GET() {
  return NextResponse.json(await getSnapshot(), { headers: { "cache-control": "no-store" } });
}
