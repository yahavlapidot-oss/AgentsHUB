import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPublicUrl, decodeEntities, htmlToText, isPrivateAddress } from "../src/lib/web/fetch-page";
import { searchProvider, webSearch } from "../src/lib/web/search";

describe("reading pages", () => {
  it("turns HTML into readable text", () => {
    const html = `<html><head><title>T</title><style>.x{}</style></head><body><h1>Hello &amp; welcome</h1><script>evil()</script><p>First<br>line</p><ul><li>one</li><li>two</li></ul></body></html>`;
    expect(htmlToText(html)).toBe("Hello & welcome\nFirst\nline\n- one\n- two");
    expect(decodeEntities("&#x5e9;&#1500;&quot;")).toBe('של"');
  });

  it("refuses private and local addresses", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    await expect(checkPublicUrl("http://localhost:3000/")).rejects.toThrow(/private/);
    await expect(checkPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private/);
    await expect(checkPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(checkPublicUrl("http://user:pw@example.com")).rejects.toThrow(/password/);
  });
});

describe("web search", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("picks the provider from the keys that are set", () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(searchProvider()).toBeNull();
    process.env.ANTHROPIC_API_KEY = "k";
    expect(searchProvider()).toBe("claude");
    process.env.BRAVE_SEARCH_API_KEY = "b";
    expect(searchProvider()).toBe("brave");
    process.env.WEB_SEARCH_PROVIDER = "claude";
    expect(searchProvider()).toBe("claude");
  });

  it("reads Tavily results", async () => {
    process.env.TAVILY_API_KEY = "t";
    process.env.WEB_SEARCH_PROVIDER = "tavily";
    const fetchMock = vi.fn(async () => Response.json({ results: [{ title: "A", url: "https://a.example", content: "about a" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const answer = await webSearch("a", { count: 3 });
    expect(answer.results).toEqual([{ title: "A", url: "https://a.example", snippet: "about a", age: undefined }]);
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ query: "a", max_results: 3 });
  });
});
