import { NextResponse, type NextRequest } from "next/server";

/**
 * When DASHBOARD_PASSWORD is set, the dashboard asks for it (HTTP Basic auth).
 * /api/v1 and /api/mcp are left to per-agent tokens.
 */
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (given === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AgentsHUB"' },
  });
}

export const config = {
  matcher: ["/((?!api/v1|api/mcp|api/health|agentshub-hook\\.mjs|_next/static|_next/image|favicon.ico).*)"],
};
