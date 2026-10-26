import { NextResponse } from "next/server";
import { makePass, PASS_COOKIE, secondFactorOn } from "@/lib/second-factor";
import { verifyTotp } from "@/lib/totp";

export const dynamic = "force-dynamic";

// A few wrong codes per address, then a pause; and each code works once.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; since: number }>();
let lastStep: number | null = null;

export async function POST(req: Request) {
  if (!secondFactorOn()) return NextResponse.json({ ok: true });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const f = failures.get(ip);
  if (f && now - f.since > WINDOW_MS) failures.delete(ip);
  if ((failures.get(ip)?.count ?? 0) >= MAX_FAILURES) return NextResponse.json({ error: "Too many wrong codes. Wait 15 minutes." }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { code?: string };
  let step: number | null = null;
  try {
    step = verifyTotp(process.env.TOTP_SECRET!, String(body.code ?? ""), { lastStep });
  } catch {
    return NextResponse.json({ error: "TOTP_SECRET on the server isn't a valid secret" }, { status: 500 });
  }
  if (step === null) {
    const cur = failures.get(ip) ?? { count: 0, since: now };
    cur.count++;
    failures.set(ip, cur);
    return NextResponse.json({ error: "That code didn't match. Check your phone's clock and try the next one." }, { status: 401 });
  }
  lastStep = step;
  failures.delete(ip);
  const pass = await makePass();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PASS_COOKIE, pass.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: pass.maxAge, path: "/" });
  return res;
}
