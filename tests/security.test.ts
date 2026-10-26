import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES, readJson, TooLarge } from "../src/lib/api";
import { middleware, sameText } from "../src/middleware";

const basic = (pw: string) => `Basic ${btoa(`user:${pw}`)}`;
const req = (auth?: string, ip = "203.0.113.7") =>
  new NextRequest("http://localhost/", { headers: { ...(auth ? { authorization: auth } : {}), "x-forwarded-for": `${ip}, 10.0.0.1` } });

afterEach(() => vi.unstubAllEnvs());

describe("dashboard password", () => {
  it("lets the right password in and asks again for a wrong one", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "s3cret-pass");
    expect((await middleware(req(basic("s3cret-pass"), "198.51.100.1"))).status).toBe(200);
    expect((await middleware(req(basic("s3cret-pasS"), "198.51.100.1"))).status).toBe(401);
    expect((await middleware(req(undefined, "198.51.100.1"))).status).toBe(401);
    expect((await middleware(req("Basic !!!not-base64", "198.51.100.1"))).status).toBe(401);
  });

  it("blocks an address after 10 wrong passwords, even with the right one", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "s3cret-pass");
    for (let i = 0; i < 10; i++) expect((await middleware(req(basic(`guess${i}`), "198.51.100.2"))).status).toBe(401);
    const blocked = await middleware(req(basic("s3cret-pass"), "198.51.100.2"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Other addresses are not affected.
    expect((await middleware(req(basic("s3cret-pass"), "198.51.100.3"))).status).toBe(200);
  });

  it("stays locked in production without a password unless told it's meant to be open", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await middleware(req())).status).toBe(503);
    vi.stubEnv("DASHBOARD_OPEN", "1");
    expect((await middleware(req())).status).toBe(200);
    vi.stubEnv("DASHBOARD_OPEN", "");
    vi.stubEnv("NODE_ENV", "development");
    expect((await middleware(req())).status).toBe(200);
  });

  it("asks for the authenticator code when two-step sign-in is on", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "s3cret-pass");
    vi.stubEnv("TOTP_SECRET", "JBSWY3DPEHPK3PXP");
    const page = (path: string, cookie?: string) =>
      new NextRequest(`http://localhost${path}`, {
        headers: { authorization: basic("s3cret-pass"), accept: "text/html", "x-forwarded-for": "198.51.100.9", ...(cookie ? { cookie } : {}) },
      });
    const redirect = await middleware(page("/usage?x=1"));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe("http://localhost/verify?next=%2Fusage%3Fx%3D1");
    expect((await middleware(page("/verify"))).status).toBe(200);
    expect((await middleware(new NextRequest("http://localhost/api/ui/snapshot", { headers: { authorization: basic("s3cret-pass") } }))).status).toBe(401);

    const { makePass, validPass, PASS_COOKIE } = await import("../src/lib/second-factor");
    const pass = await makePass();
    expect((await middleware(page("/usage", `${PASS_COOKIE}=${pass.value}`))).status).toBe(200);
    expect(await validPass(pass.value.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toBe(false);
    expect(await validPass(pass.value, Date.now() + 31 * 86_400_000)).toBe(false);
    // A new secret signs everyone out.
    vi.stubEnv("TOTP_SECRET", "KRSXG5CTMVRXEZLU");
    expect(await validPass(pass.value)).toBe(false);
  });

  it("compares the whole text", () => {
    expect(sameText("abc", "abc")).toBe(true);
    expect(sameText("abd", "abc")).toBe(false);
    expect(sameText("ab", "abc")).toBe(false);
    expect(sameText("abcd", "abc")).toBe(false);
    expect(sameText("", "")).toBe(true);
  });
});

describe("request size", () => {
  it("refuses bodies over the limit, by header or by actual size", async () => {
    const big = new Request("http://x/", { method: "POST", body: "x", headers: { "content-length": String(MAX_BODY_BYTES + 1) } });
    await expect(readJson(big)).rejects.toBeInstanceOf(TooLarge);
    const stream = new ReadableStream({
      start(c) {
        const chunk = new Uint8Array(1024 * 1024).fill(32);
        for (let i = 0; i <= MAX_BODY_BYTES / chunk.length; i++) c.enqueue(chunk);
        c.close();
      },
    });
    const sneaky = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readJson(sneaky)).rejects.toBeInstanceOf(TooLarge);
    expect(await readJson(new Request("http://x/", { method: "POST", body: '{"a":1}' }))).toEqual({ a: 1 });
  });
});
