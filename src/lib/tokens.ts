import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "ahub_";

/** A new agent API token. Shown to the user once; only its hash is stored. */
export function generateAgentToken(): string {
  return PREFIX + randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Pulls the token out of an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match && match[1].startsWith(PREFIX) ? match[1] : null;
}
