import { NextResponse, type NextRequest } from "next/server";

/**
 * The dashboard asks for DASHBOARD_PASSWORD (HTTP Basic auth). In production
 * it stays locked when no password is set, unless DASHBOARD_OPEN=1 says it's
 * meant to be open (e.g. behind another login). /api/v1 and /api/mcp are left
 * to per-agent tokens.
 *
 * Wrong passwords are limited per address: after MAX_FAILURES in WINDOW_MS the
 * address gets 429 until the window passes. The count lives in this server's
 * memory, which is enough for one instance.
 */
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; since: number }>();

export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV !== "production" || process.env.DASHBOARD_OPEN === "1") return NextResponse.next();
    return new NextResponse("Set DASHBOARD_PASSWORD on the server (or DASHBOARD_OPEN=1 to leave the dashboard open).", { status: 503 });
  }

  const ip = clientIp(req);
  const now = Date.now();
  const seen = failures.get(ip);
  if (seen && now - seen.since > WINDOW_MS) failures.delete(ip);
  const blocked = failures.get(ip);
  if (blocked && blocked.count >= MAX_FAILURES) {
    const wait = Math.ceil((blocked.since + WINDOW_MS - now) / 1000);
    return new NextResponse("Too many wrong passwords. Try again later.", { status: 429, headers: { "retry-after": String(wait) } });
  }

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let given = "";
    try {
      const decoded = atob(header.slice(6));
      given = decoded.slice(decoded.indexOf(":") + 1);
    } catch {
      // Not valid base64: treat as a wrong password.
    }
    if (sameText(given, password)) {
      failures.delete(ip);
      return NextResponse.next();
    }
    const f = failures.get(ip) ?? { count: 0, since: now };
    f.count++;
    failures.set(ip, f);
    // Keep the map small if many addresses try.
    if (failures.size > 10_000) failures.delete(failures.keys().next().value!);
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AgentsHUB"' },
  });
}

/** Compares without stopping at the first different character, so timing doesn't leak the password. */
export function sameText(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}

function clientIp(req: NextRequest): string {
  // Railway's proxy puts the caller first in x-forwarded-for.
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export const config = {
  matcher: ["/((?!api/v1|api/mcp|api/health|agentshub-hook\\.mjs|_next/static|_next/image|favicon.ico).*)"],
};
