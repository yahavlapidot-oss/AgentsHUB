/**
 * The pass the dashboard gives you after a correct authenticator code: a
 * cookie holding an expiry time and an HMAC of it. The middleware (edge) and
 * the verify route (Node) both check it with WebCrypto. The key comes from
 * TOTP_SECRET and DASHBOARD_PASSWORD, so changing either signs everyone out.
 */
export const PASS_COOKIE = "ah_2fa";
export const REMEMBER_DAYS = Number(process.env.TOTP_REMEMBER_DAYS ?? 30);

export function secondFactorOn(): boolean {
  return Boolean(process.env.TOTP_SECRET?.trim());
}

async function key(): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`agentshub-2fa:${process.env.TOTP_SECRET ?? ""}:${process.env.DASHBOARD_PASSWORD ?? ""}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/.test(s) || s.length % 2) return null;
  const out = new Uint8Array(new ArrayBuffer(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function makePass(now = Date.now()): Promise<{ value: string; maxAge: number }> {
  const maxAge = Math.round(REMEMBER_DAYS * 86_400);
  const expires = String(now + maxAge * 1000);
  const sig = await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(expires));
  return { value: `${expires}.${toHex(sig)}`, maxAge };
}

export async function validPass(value: string | undefined, now = Date.now()): Promise<boolean> {
  if (!value) return false;
  const [expires, sig] = value.split(".");
  if (!expires || !sig || !(Number(expires) > now)) return false;
  const bytes = fromHex(sig);
  if (!bytes) return false;
  return crypto.subtle.verify("HMAC", await key(), bytes, new TextEncoder().encode(expires));
}
