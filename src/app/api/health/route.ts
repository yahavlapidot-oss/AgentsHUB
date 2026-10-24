import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Used by the host to check the app is up. Open to everyone; returns no data. */
export function GET() {
  return NextResponse.json({ ok: true });
}
