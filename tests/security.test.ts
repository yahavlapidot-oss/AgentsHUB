import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES, readJson, TooLarge } from "../src/lib/api";
import { middleware, sameText } from "../src/middleware";

const basic = (pw: string) => `Basic ${btoa(`user:${pw}`)}`;
const req = (auth?: string, ip = "203.0.113.7") =>
  new NextRequest("http://localhost/", { headers: { ...(auth ? { authorization: auth } : {}), "x-forwarded-for": `${ip}, 10.0.0.1` } });

afterEach(() => vi.unstubAllEnvs());

describe("dashboard password", () => {
  it("lets the right password in and asks again for a wrong one", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "s3cret-pass");
    expect(middleware(req(basic("s3cret-pass"), "198.51.100.1")).status).toBe(200);
    expect(middleware(req(basic("s3cret-pasS"), "198.51.100.1")).status).toBe(401);
    expect(middleware(req(undefined, "198.51.100.1")).status).toBe(401);
    expect(middleware(req("Basic !!!not-base64", "198.51.100.1")).status).toBe(401);
  });

  it("blocks an address after 10 wrong passwords, even with the right one", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "s3cret-pass");
    for (let i = 0; i < 10; i++) expect(middleware(req(basic(`guess${i}`), "198.51.100.2")).status).toBe(401);
    const blocked = middleware(req(basic("s3cret-pass"), "198.51.100.2"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Other addresses are not affected.
    expect(middleware(req(basic("s3cret-pass"), "198.51.100.3")).status).toBe(200);
  });

  it("stays locked in production without a password unless told it's meant to be open", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(middleware(req()).status).toBe(503);
    vi.stubEnv("DASHBOARD_OPEN", "1");
    expect(middleware(req()).status).toBe(200);
    vi.stubEnv("DASHBOARD_OPEN", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(middleware(req()).status).toBe(200);
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
