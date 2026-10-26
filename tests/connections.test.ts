import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-conn-")), "test.db")}`;
process.env.CONNECTIONS_KEY = "test-connections-key-0123456789";

let data: typeof import("../src/lib/data");
let vault: typeof import("../src/lib/vault");
let conns: typeof import("../src/lib/connections");
let hub: typeof import("../src/lib/tool-hub");
let mcp: typeof import("../src/lib/mcp-client");
let google: typeof import("../src/lib/google");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  vault = await import("../src/lib/vault");
  conns = await import("../src/lib/connections");
  hub = await import("../src/lib/tool-hub");
  mcp = await import("../src/lib/mcp-client");
  google = await import("../src/lib/google");
});

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("vault", () => {
  it("seals and opens, and refuses anything tampered with", () => {
    const sealed = vault.seal("ghp_secret");
    expect(sealed).not.toContain("ghp_secret");
    expect(vault.open(sealed)).toBe("ghp_secret");
    const parts = sealed.split(":");
    parts[3] = Buffer.from("other").toString("base64");
    expect(() => vault.open(parts.join(":"))).toThrow();
    expect(vault.seal("")).toBe("");
  });
});

describe("connections", () => {
  it("gives tools only to the agents a connection allows", async () => {
    const { agent: a } = await data.createAgent({ name: "Dev", provider: "anthropic", model: "x", kind: "hosted" });
    const { agent: b } = await data.createAgent({ name: "Writer", provider: "anthropic", model: "x", kind: "hosted" });
    const c = await conns.createConnection({ service: "github", label: "GitHub", secret: "ghp_abc", meta: { defaultRepo: "me/app" }, agentIds: [a.id] });
    expect((await conns.getConnections())[0]).not.toHaveProperty("secret");

    const forA = hub.toolsForAgent(a, { sandbox: false, services: await conns.servicesFor(a.id) }).map((t) => t.name);
    const forB = hub.toolsForAgent(b, { sandbox: false, services: await conns.servicesFor(b.id) }).map((t) => t.name);
    expect(forA).toContain("github_read_file");
    expect(forB).not.toContain("github_read_file");
    expect(forB).not.toContain("gmail_send");

    await expect(conns.secretFor(b.id, "github")).rejects.toThrow(/no github connection/);
    expect((await conns.secretFor(a.id, "github")).secret).toBe("ghp_abc");

    await conns.updateConnection(c.id, { enabled: false });
    expect(await conns.servicesFor(a.id)).toEqual(new Set());
    await conns.updateConnection(c.id, { enabled: true });
  });

  it("reads a GitHub file as outside content and asks before commenting", async () => {
    const { agent } = await data.createAgent({ name: "Reader", provider: "anthropic", model: "x", kind: "hosted" });
    await conns.createConnection({ service: "github", label: "GitHub 2", secret: "ghp_xyz", meta: { defaultRepo: "me/site" }, agentIds: [agent.id] });
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, auth: new Headers(init.headers).get("authorization") });
        return json({ type: "file", path: "README.md", size: 5, encoding: "base64", content: Buffer.from("hello").toString("base64") });
      }),
    );
    const tools = hub.toolsForAgent(agent, { sandbox: false, services: new Set(["github"]) });
    const ctx = { agent, taint: { tainted: false, sources: [] as string[] } };
    const read = tools.find((t) => t.name === "github_read_file")!;
    const out = JSON.stringify(await read.run({ path: "README.md" }, ctx));
    expect(calls[0].url).toBe("https://api.github.com/repos/me/site/contents/README.md");
    expect(calls[0].auth).toBe("Bearer ghp_xyz");
    expect(out).toContain("hello");
    expect(out).toContain("untrusted");
    expect(ctx.taint.tainted).toBe(true);

    const comment = tools.find((t) => t.name === "github_comment")!;
    const r = (await comment.run({ number: 1, body: "Looks good" }, ctx)) as { done: boolean; decision: string };
    expect(r.done).toBe(false);
    expect(r.decision).toBe("ask");
    expect(calls).toHaveLength(1);
  });
});

describe("MCP client", () => {
  it("turns a server's tools into agent tools and asks before ones that change things", async () => {
    const { agent } = await data.createAgent({ name: "Ops", provider: "anthropic", model: "x", kind: "hosted" });
    await conns.createConnection({ service: "mcp", label: "Notion", secret: "tok", meta: { url: "https://mcp.example.com/mcp", approval: "writes" }, agentIds: [agent.id] });
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        methods.push(body.method);
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
        if (!("id" in body)) return new Response(null, { status: 202 });
        if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }, { headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
        if (body.method === "tools/list") {
          return json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                { name: "search-pages", description: "Search", inputSchema: { type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } },
                { name: "create-page", description: "Create", inputSchema: { type: "object", properties: {} } },
              ],
            },
          });
        }
        // tools/call answers as a stream, the way many servers do.
        return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "Found 2 pages" }] } })}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    const { tools, problems } = await mcp.mcpToolsFor(agent.id);
    expect(problems).toEqual([]);
    expect(tools.map((t) => t.name)).toEqual(["mcp_notion_search_pages", "mcp_notion_create_page"]);
    expect(hub.toolInfo("mcp_notion_search_pages").needsConnection).toBe("mcp");

    const ctx = { agent, taint: { tainted: false, sources: [] as string[] } };
    expect(JSON.stringify(await tools[0].run({ q: "plans" }, ctx))).toContain("Found 2 pages");
    expect(ctx.taint.tainted).toBe(true);
    const r = (await tools[1].run({}, ctx)) as { done: boolean; decision: string };
    expect(r.decision).toBe("ask");
    expect(methods.filter((m) => m === "tools/call")).toHaveLength(1);
    expect(methods).toContain("notifications/initialized");
  });

  it("skips a server it can't reach and says why", async () => {
    const { agent } = await data.createAgent({ name: "Ops2", provider: "anthropic", model: "x", kind: "hosted" });
    await conns.createConnection({ service: "mcp", label: "Down", secret: "", meta: { url: "https://down.example.com/mcp" }, agentIds: [agent.id] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const { tools, problems } = await mcp.mcpToolsFor(agent.id);
    expect(tools).toEqual([]);
    expect(problems[0]).toMatch(/Down: MCP server answered 500/);
  });
});

describe("Gmail", () => {
  it("builds a message Gmail accepts, with Hebrew subjects encoded", () => {
    const raw = google.buildEmail({ to: "a@b.com", subject: "שלום", body: "היי" });
    const text = Buffer.from(raw, "base64url").toString("utf8");
    expect(text).toContain("To: a@b.com\r\n");
    expect(text).toContain("Subject: =?UTF-8?B?");
    expect(text).not.toContain("Cc:");
    expect(text).not.toMatch(/\r\n\r\n\r\n/);
  });
});
