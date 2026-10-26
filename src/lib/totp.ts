/**
 * Time-based one-time codes (RFC 6238), the six digits an authenticator app
 * (Google Authenticator, 1Password, Authy) shows every 30 seconds.
 */
import { createHmac, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_S = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Not a base32 secret");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totp(secretB32: string, at = Date.now(), digits = 6): string {
  return hotp(base32Decode(secretB32), Math.floor(at / 1000 / STEP_S), digits);
}

/**
 * The time step a code matches (allowing one step of clock drift either way),
 * or null. Pass the last step used so a code can't be used twice.
 */
export function verifyTotp(secretB32: string, code: string, opts: { at?: number; lastStep?: number | null } = {}): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secretB32);
  const step = Math.floor((opts.at ?? Date.now()) / 1000 / STEP_S);
  for (const s of [step, step - 1, step + 1]) {
    if (opts.lastStep != null && s <= opts.lastStep) continue;
    if (hotp(key, s) === c) return s;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer = "AgentsHUB"): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_S}`;
}
