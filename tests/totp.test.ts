import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, newTotpSecret, otpauthUri, totp, verifyTotp } from "../src/lib/totp";

describe("one-time codes", () => {
  it("matches the RFC 6238 test vector", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totp(secret, 59_000, 8)).toBe("94287082");
    expect(totp(secret, 1_111_111_109_000, 8)).toBe("07081804");
    expect(hotp(Buffer.from("12345678901234567890"), 0)).toBe("755224");
  });

  it("accepts a code from the step before or after, once", () => {
    const secret = newTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    const at = 1_800_000_000_000;
    const code = totp(secret, at - 30_000);
    const step = verifyTotp(secret, code, { at });
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, { at, lastStep: step })).toBeNull();
    expect(verifyTotp(secret, totp(secret, at - 90_000), { at })).toBeNull();
    expect(verifyTotp(secret, "12345", { at })).toBeNull();
    expect(otpauthUri(secret, "you")).toContain(`secret=${secret}`);
  });
});
