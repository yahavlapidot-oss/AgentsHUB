import { NextResponse } from "next/server";
import { runnerHealth } from "@/lib/monitor";
import { checkDatabase } from "@/lib/status";

export const dynamic = "force-dynamic";

/**
 * Used by the host to check the app is up. Open to everyone, so it says only
 * whether the database answers and whether the runner is going round. 503
 * when the database doesn't answer.
 */
export async function GET() {
  const database = await checkDatabase();
  const runner = runnerHealth().state;
  return NextResponse.json({ ok: database.ok, database: database.ok ? "ok" : "down", runner }, { status: database.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
