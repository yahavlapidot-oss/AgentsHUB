/**
 * Encrypts connection secrets (tokens, refresh tokens, API keys) before they
 * reach the database, with AES-256-GCM. The key comes from CONNECTIONS_KEY;
 * without it, from DASHBOARD_PASSWORD (changing the password then makes saved
 * secrets unreadable, so set CONNECTIONS_KEY for anything you keep).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";

const VERSION = "v1";

export class VaultError extends Error {}

export function vaultKeySource(): "connections_key" | "dashboard_password" | null {
  if (process.env.CONNECTIONS_KEY && process.env.CONNECTIONS_KEY.length >= 16) return "connections_key";
  if (process.env.DASHBOARD_PASSWORD) return "dashboard_password";
  return null;
}

let cached: { source: string; key: Buffer } | null = null;

function key(): Buffer {
  const source = vaultKeySource();
  if (!source) throw new VaultError("Set CONNECTIONS_KEY (any long random text) on the server before saving connections");
  const material = source === "connections_key" ? process.env.CONNECTIONS_KEY! : process.env.DASHBOARD_PASSWORD!;
  const id = createHash("sha256").update(`${source}:${material}`).digest("hex");
  if (cached?.source === id) return cached.key;
  const k = source === "connections_key" ? createHash("sha256").update(material).digest() : scryptSync(material, "agentshub-connections", 32);
  cached = { source: id, key: k };
  return k;
}

export function seal(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function open(sealed: string): string {
  if (!sealed) return "";
  const [version, iv, tag, body] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !body) throw new VaultError("Unknown secret format");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("Can't read the saved secret. Was CONNECTIONS_KEY or the dashboard password changed? Connect it again.");
  }
}
