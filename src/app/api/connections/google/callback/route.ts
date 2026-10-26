import { NextResponse, type NextRequest } from "next/server";
import { createConnection, getConnections, updateConnection } from "@/lib/connections";
import { exchangeCode } from "@/lib/google";
import { sameText } from "@/middleware";
import { boardLink } from "@/lib/notify";

// Google sends you back here with a code; it becomes an encrypted refresh token.
export async function GET(req: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(boardLink(`/connections?${q}`));
    res.cookies.delete({ name: "google_oauth_state", path: "/api/connections/google" });
    return res;
  };
  const url = req.nextUrl;
  const state = url.searchParams.get("state") ?? "";
  const expected = req.cookies.get("google_oauth_state")?.value ?? "";
  if (!state || !expected || !sameText(state, expected)) return back("error=The+sign-in+expired.+Try+again.");
  if (url.searchParams.get("error")) return back(`error=${encodeURIComponent(url.searchParams.get("error")!)}`);
  const code = url.searchParams.get("code");
  if (!code) return back("error=No+code+from+Google");
  try {
    const { refreshToken, email, scopes } = await exchangeCode(code);
    // Signing in again with the same account replaces its token instead of adding a second one.
    const same = (await getConnections()).find((c) => c.service === "google" && c.meta.email === email);
    if (same) await updateConnection(same.id, { secret: refreshToken, meta: { ...same.meta, email, scopes }, lastError: null, enabled: true });
    else await createConnection({ service: "google", label: `Google (${email})`, secret: refreshToken, meta: { email, scopes } });
    return back("google=connected");
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 300))}`);
  }
}
