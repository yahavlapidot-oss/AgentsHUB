import { NextResponse } from "next/server";
import { getLiveWork } from "@/lib/live-work";

export const dynamic = "force-dynamic";

/** Live workspace data. Protected by the dashboard password in middleware. */
export async function GET() {
  return NextResponse.json(await getLiveWork(), { headers: { "cache-control": "no-store" } });
}
