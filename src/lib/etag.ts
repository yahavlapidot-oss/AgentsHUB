import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

/** A tag for live data that ignores generatedAt, so it changes only when the content does. */
export function contentTag<T extends { generatedAt: number }>(data: T): string {
  const { generatedAt: _, ...rest } = data;
  return `"${createHash("sha1").update(JSON.stringify(rest)).digest("base64url")}"`;
}

/** JSON for a poll: 304 with no body when the caller already has this content. */
export function pollResponse<T extends { generatedAt: number }>(req: Request, data: T): NextResponse {
  const etag = contentTag(data);
  const headers = { "cache-control": "no-store", etag };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return NextResponse.json(data, { headers });
}
