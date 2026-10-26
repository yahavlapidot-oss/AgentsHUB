import { NextResponse, type NextRequest } from "next/server";
import { LOCKED_HEADER, PASS_COOKIE, secondFactorOn, validPass } from "./lib/second-factor";

/**
 * The dashboard asks for DASHBOARD_PASSWORD (HTTP Basic auth). In production
 * it stays locked when no password is set, unless DASHBOARD_OPEN=1 says it's
 * meant to be open (e.g. behind another login). /api/v1 and /api/mcp are left
 * to per-agent tokens.
 *
 * Wrong passwords are limited per address: after MAX_FAILURES in WINDOW_MS the
 * address gets 429 until the window passes. The count lives in this server's
 * memory, which is enough for one instance.
 *
 * With TOTP_SECRET set, the password alone isn't enough: the browser also needs
 * the pass cookie it gets on /verify for a code from your authenticator app.
 */
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; since: number }>();

export async function middleware(req: NextRequest) {
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
      return secondFactor(req);
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

/** Paths that work with the password alone, so you can enter the code. */
const VERIFY_PATHS = ["/verify", "/api/2fa/verify"];

async function secondFactor(req: NextRequest): Promise<NextResponse> {
  const headers = new Headers(req.headers);
  headers.delete(LOCKED_HEADER);
  if (!secondFactorOn() || (await validPass(req.cookies.get(PASS_COOKIE)?.value))) return NextResponse.next({ request: { headers } });
  if (VERIFY_PATHS.includes(req.nextUrl.pathname)) {
    headers.set(LOCKED_HEADER, "1");
    return NextResponse.next({ request: { headers } });
  }
  const page = req.method === "GET" && !req.nextUrl.pathname.startsWith("/api/") && (req.headers.get("accept") ?? "").includes("text/html");
  if (page) {
    const url = req.nextUrl.clone();
    url.pathname = "/verify";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  // 403, not 401: a 401 makes the browser forget the password it saved and
  // ask for it again, over and over, while the code page is open.
  return NextResponse.json({ error: "Enter your authenticator code at /verify first" }, { status: 403 });
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
  matcher: ["/((?!api/v1|api/mcp|api/health|api/telegram|sw\\.js|agentshub-hook\\.mjs|manifest\\.webmanifest|icon\\.svg|icon-192\\.png|icon-512\\.png|apple-icon\\.png|_next/static|_next/image|favicon.ico).*)"],
};
