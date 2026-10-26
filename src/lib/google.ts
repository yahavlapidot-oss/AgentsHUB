/**
 * Google sign-in for Gmail, Calendar and Drive. You make an OAuth client in
 * Google Cloud (free) and set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; the
 * Connections page then sends you to Google, and the refresh token comes back
 * to /api/connections/google/callback and is saved encrypted.
 *
 * While the Google app is in "Testing", Google expires the sign-in after 7
 * days; publish the app (no review is needed for your own account) to keep it.
 */
import { secretFor } from "./connections";
import { boardLink } from "./notify";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
];

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(): string {
  return boardLink("/api/connections/google/callback");
}

export function googleAuthUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) throw new Error(`Google sign-in failed: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

export async function exchangeCode(code: string): Promise<{ refreshToken: string; email: string; scopes: string[] }> {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri() });
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token. Remove AgentsHUB from your Google account's third-party access and connect again.");
  const info = (await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } })).json()) as { email?: string };
  return { refreshToken: t.refresh_token, email: info.email ?? "Google account", scopes: (t.scope ?? "").split(" ").filter(Boolean) };
}

const accessCache = new Map<string, { token: string; until: number }>();

/** A fresh access token for the agent's Google connection. */
export async function googleAccess(agentId: string): Promise<{ token: string; email: string }> {
  const { connection, secret } = await secretFor(agentId, "google");
  return { token: await accessToken(connection.id, secret), email: String(connection.meta.email ?? "") };
}

/** An access token from a refresh token, cached until a minute before it expires. */
export async function accessToken(connectionId: string, refreshToken: string): Promise<string> {
  const hit = accessCache.get(connectionId);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const t = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  accessCache.set(connectionId, { token: t.access_token, until: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

export async function googleApi<T>(token: string, url: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Google API ${res.status}: ${err.error?.message ?? res.statusText}`);
  }
  return (init.raw ? await res.text() : await res.json()) as T;
}

/** An RFC 2822 message, base64url-encoded the way Gmail wants it. */
export function buildEmail(input: { from?: string; to: string; cc?: string; subject: string; body: string; inReplyTo?: string }): string {
  const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
  const lines = [
    input.from ? `From: ${input.from}` : null,
    `To: ${input.to}`,
    input.cc ? `Cc: ${input.cc}` : null,
    `Subject: ${encodeHeader(input.subject)}`,
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : null,
    input.inReplyTo ? `References: ${input.inReplyTo}` : null,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.body, "utf8").toString("base64"),
  ].filter((l): l is string => l !== null);
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };

/** The plain text of a Gmail message, falling back to its HTML with the tags removed. */
export function messageText(payload: Part): string {
  const find = (p: Part, type: string): string | null => {
    if (p.mimeType === type && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
    for (const c of p.parts ?? []) {
      const hit = find(c, type);
      if (hit) return hit;
    }
    return null;
  };
  const plain = find(payload, "text/plain");
  if (plain) return plain;
  const html = find(payload, "text/html");
  return html ? html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}
