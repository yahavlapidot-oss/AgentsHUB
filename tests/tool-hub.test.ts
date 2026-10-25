import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-tools-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let hub: typeof import("../src/lib/tool-hub");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  hub = await import("../src/lib/tool-hub");
});

const names = (tools: { name: string }[]) => tools.map((t) => t.name);

describe("tool catalog", () => {
  it("describes every tool once", () => {
    const all = names(hub.ALL_TOOLS);
    expect(new Set(all).size).toBe(all.length);
    for (const n of all) expect(hub.CATALOG[n], n).toBeDefined();
    expect(Object.keys(hub.CATALOG).sort()).toEqual([...all].sort());
  });

  it("gives sandbox tools only with a sandbox, drops turned-off tools and keeps core ones", () => {
    const agent = { disabledTools: ["send_message", "complete_task", "run_command"] };
    const without = names(hub.toolsForAgent(agent, { sandbox: false }));
    expect(without).not.toContain("send_message");
    expect(without).not.toContain("write_file");
    expect(without).toContain("complete_task");
    const withBox = names(hub.toolsForAgent(agent, { sandbox: true }));
    expect(withBox).toContain("write_file");
    expect(withBox).not.toContain("run_command");
  });

  it("only stores tools that exist and can be turned off", () => {
    expect(hub.cleanDisabledTools(["send_message", "complete_task", "nope", "send_message"])).toEqual(["send_message"]);
  });
});

describe("tool executor", () => {
  it("refuses turned-off tools, stops repeated identical calls and returns errors as results", async () => {
    const { agent } = await data.createAgent({ name: "Exec", provider: "anthropic", model: "x", kind: "hosted" });
    await data.setAgentDisabledTools(agent.id, ["send_message"]);
    const row = (await data.getAgent(agent.id))!;
    const task = await data.createTask({ title: "Exec task" });
    const exec = new hub.ToolExecutor(hub.toolsForAgent(row, { sandbox: false }), { agent: row }, { taskId: task.id });

    const off = await exec.run({ id: "1", name: "send_message", args: { text: "hi" } });
    expect(off).toMatchObject({ isError: true, output: "send_message is turned off for you" });
    expect((await exec.run({ id: "2", name: "nope", args: {} })).output).toBe("Unknown tool nope");
    expect((await exec.run({ id: "3", name: "get_task", args: { taskId: "missing" } })).isError).toBe(true);

    const note = { title: "Same", text: "again" };
    for (let i = 0; i < 5; i++) expect((await exec.run({ id: `n${i}`, name: "write_note", args: note })).isError).toBeUndefined();
    const sixth = await exec.run({ id: "n6", name: "write_note", args: { text: "again", title: "Same" } });
    expect(sixth.isError).toBe(true);
    expect(sixth.output).toContain("5 times");
    // Polling tools may repeat freely.
    for (let i = 0; i < 7; i++) expect((await exec.run({ id: `c${i}`, name: "check_inbox", args: {} })).isError).toBeUndefined();

    const logged = await data.getEvents({ taskId: task.id });
    expect(logged.some((e) => e.type === "tool_call" && e.payload.tool === "get_task" && e.payload.error)).toBe(true);
  });
});

describe("MCP and turned-off tools", () => {
  async function call(token: string, body: unknown) {
    const { POST } = await import("../src/app/api/mcp/route");
    const { NextRequest } = await import("next/server");
    const res = await POST(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
    return res.json();
  }

  it("hides turned-off tools and the sandbox tools from outside agents", async () => {
    const { agent, token } = await data.createAgent({ name: "Outside", provider: "openai", model: "gpt-5-codex", kind: "mcp" });
    await data.setAgentDisabledTools(agent.id, ["create_task"]);
    const list = await call(token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const listed = names(list.result.tools);
    expect(listed).not.toContain("create_task");
    expect(listed).not.toContain("run_command");
    expect(listed).toContain("save_artifact");
    const res = await call(token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_task", arguments: { title: "x" } } });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("turned off");
  });
});
