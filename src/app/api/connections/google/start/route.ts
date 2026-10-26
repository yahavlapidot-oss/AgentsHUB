import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleAuthUrl, googleConfigured } from "@/lib/google";
import { boardLink } from "@/lib/notify";

// Sends you to Google's sign-in. A random state in a short-lived cookie ties the answer to this browser.
export async function GET() {
  if (!googleConfigured()) return NextResponse.redirect(boardLink("/connections?error=Set+GOOGLE_CLIENT_ID+and+GOOGLE_CLIENT_SECRET+first"));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.cookies.set("google_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/connections/google" });
  return res;
}
