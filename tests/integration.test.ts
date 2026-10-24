import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-int-")), "test.db")}`;

// The runner test drives a scripted model instead of a real provider.
const script: { calls: { name: string; args: unknown }[] }[] = [];
vi.mock("../src/lib/runner/providers", () => ({
  MissingKeyError: class extends Error {},
  createChat: () => ({
    send: async () => {
      const step = script.shift() ?? { calls: [] };
      return {
        text: "",
        model: "claude-sonnet-5-5",
        usage: { tokensIn: 1000, tokensOut: 100 },
        toolCalls: step.calls.map((c, i) => ({ id: `call_${i}`, ...c })),
      };
    },
  }),
}));

let data: typeof import("../src/lib/data");
let policy: typeof import("../src/lib/policy");
let control: typeof import("../src/lib/control");
let tools: typeof import("../src/lib/agent-tools");
let runner: typeof import("../src/lib/runner/runner");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  policy = await import("../src/lib/policy");
  control = await import("../src/lib/control");
  tools = await import("../src/lib/agent-tools");
  runner = await import("../src/lib/runner/runner");
});

describe("approval policy", () => {
  it.each([
    ["Bash: rm -rf build", ["irreversible"]],
    ["Bash: git push --force origin main", ["irreversible", "external"]],
    ["Bash: psql -c 'DROP TABLE users'", ["irreversible"]],
    ["Bash: npm publish", ["external"]],
    ["Bash: gh pr merge 12", ["external"]],
    ["Buy the pro plan for $20", ["money"]],
    ["Bash: curl https://api.stripe.com/v1/charges", ["money"]],
    ["Send an email to the customer list", ["external"]],
  ])("flags %s", (text, expected) => {
    const r = policy.evaluatePolicy(text);
    expect(r.requiresApproval).toBe(true);
    expect([...r.categories].sort()).toEqual([...expected].sort());
  });

  it.each(["Bash: npm test", "Bash: git status", "Bash: ls -la", "Bash: git commit -m 'wip'"])("lets %s through", (text) => {
    expect(policy.evaluatePolicy(text).requiresApproval).toBe(false);
  });

  it("never stops local file tools", () => {
    expect(policy.evaluateToolCall("Write", { file_path: "deploy.sh", content: "git push" }).requiresApproval).toBe(false);
    expect(policy.evaluateToolCall("Bash", { command: "git push" }).requiresApproval).toBe(true);
  });
});

describe("action gate", () => {
  it("asks once, then allows exactly one run of the approved action", async () => {
    const { agent } = await data.createAgent({ name: "Gate", provider: "anthropic", model: "claude-opus-5-5" });
    const action = "Bash: git push origin main";

    const first = await control.gateAction(agent.id, { action });
    expect(first.decision).toBe("ask");
    // Asking again while it's pending doesn't open a second approval.
    const again = await control.gateAction(agent.id, { action });
    expect(again.decision === "ask" && first.decision === "ask" && again.approval.id === first.approval.id).toBe(true);

    if (first.decision !== "ask") throw new Error("expected ask");
    await data.decideApproval(first.approval.id, "approved");
    expect((await control.gateAction(agent.id, { action })).decision).toBe("allow");
    expect((await control.gateAction(agent.id, { action })).decision).toBe("ask");
  });

  it("reports a denial once and holds paused agents", async () => {
    const { agent } = await data.createAgent({ name: "Gate2", provider: "openai", model: "gpt-5" });
    const action = "Bash: npm publish";
    const first = await control.gateAction(agent.id, { action });
    if (first.decision !== "ask") throw new Error("expected ask");
    await data.decideApproval(first.approval.id, "denied");
    expect((await control.gateAction(agent.id, { action })).decision).toBe("deny");

    await data.sendCommand(agent.id, "pause");
    expect((await control.gateAction(agent.id, { action: "Bash: ls" })).decision).toBe("paused");
  });
});

describe("agent tools", () => {
  it("splits a task, chains dependencies and blocks claiming out of order", async () => {
    const { agent } = await data.createAgent({ name: "Planner", provider: "google", model: "gemini-2.5-pro" });
    const parent = await data.createTask({ title: "Launch page" });
    const ctx = { agent };
    const res = (await tools.findTool("create_subtasks")!.run(
      { parentTaskId: parent.id, subtasks: [{ title: "Write copy" }, { title: "Build page", dependsOnPrevious: true }] },
      ctx,
    )) as { subtasks: { id: string; dependsOn: string[] }[] };
    expect(res.subtasks).toHaveLength(2);
    expect(res.subtasks[1].dependsOn).toEqual([res.subtasks[0].id]);

    await expect(tools.findTool("claim_task")!.run({ taskId: res.subtasks[1].id }, ctx)).rejects.toThrow(/depends on/);
    await tools.findTool("claim_task")!.run({ taskId: res.subtasks[0].id }, ctx);
    expect((await data.getTask(res.subtasks[0].id))?.column).toBe("in_progress");
  });

  it("rejects bad input with a readable error", async () => {
    const { agent } = await data.createAgent({ name: "X", provider: "anthropic", model: "claude-haiku-5-5" });
    await expect(tools.findTool("report_progress")!.run({ progressPct: 50 }, { agent })).rejects.toBeInstanceOf(tools.ToolInputError);
  });
});

describe("MCP endpoint", () => {
  async function call(token: string | null, body: unknown) {
    const { POST } = await import("../src/app/api/mcp/route");
    const { NextRequest } = await import("next/server");
    return POST(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
  }

  it("needs an agent key", async () => {
    expect((await call(null, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
  });

  it("initializes, lists tools and runs one", async () => {
    const { token } = await data.createAgent({ name: "MCP", provider: "openai", model: "gpt-5-codex", kind: "mcp" });
    const init = await (await call(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect((await call(token, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

    const list = await (await call(token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("claim_task");

    const msg = await (
      await call(token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "send_message", arguments: { text: "hi team" } } })
    ).json();
    expect(msg.result.isError).toBeUndefined();
    const bad = await (
      await call(token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_task", arguments: { taskId: "nope" } } })
    ).json();
    expect(bad.result.isError).toBe(true);
  });
});

describe("hosted runner", () => {
  it("picks owned work first, then the highest-priority free task", async () => {
    const { agent } = await data.createAgent({ name: "Picker", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted" });
    const low = await data.createTask({ title: "low", column: "ready", priority: "low" });
    const high = await data.createTask({ title: "high", column: "ready", priority: "critical" });
    expect((await runner.pickTask(agent))?.id).toBe(high.id);
    const mine = await data.createTask({ title: "mine", ownerAgentId: agent.id });
    expect((await runner.pickTask(agent))?.id).toBe(mine.id);
    await data.updateTask(low.id, { column: "done" });
  });

  it("runs a task to review and records tokens and cost", async () => {
    const { agent } = await data.createAgent({ name: "Worker", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted" });
    const task = await data.createTask({ title: "Write a haiku", ownerAgentId: agent.id });
    script.push(
      { calls: [{ name: "report_progress", args: { taskId: task.id, progressPct: 50, note: "Drafting" } }] },
      { calls: [{ name: "complete_task", args: { taskId: task.id, summary: "An old silent pond" } }] },
    );
    const row = (await data.getHostedAgents()).find((a) => a.id === agent.id)!;
    await runner.runTask(row, task);

    const done = await data.getTask(task.id);
    expect(done?.column).toBe("review");
    expect(done?.progressPct).toBe(100);
    const [run] = await data.getRuns({ agentId: agent.id });
    expect(run.outcome).toBe("success");
    expect(run.tokensIn).toBe(2000);
    expect(run.costUsd).toBeCloseTo((2000 * 2 + 200 * 10) / 1_000_000);
  });

  it("stops when the user sends stop", async () => {
    const { agent } = await data.createAgent({ name: "Stopper", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted" });
    const task = await data.createTask({ title: "Long job", ownerAgentId: agent.id });
    await data.sendCommand(agent.id, "stop");
    script.push({ calls: [{ name: "report_progress", args: { taskId: task.id, note: "starting" } }] });
    const row = (await data.getHostedAgents()).find((a) => a.id === agent.id)!;
    await runner.runTask(row, task);
    const after = await data.getTask(task.id);
    expect(after?.column).toBe("ready");
    expect(after?.ownerAgentId).toBeNull();
    expect((await data.getRuns({ agentId: agent.id }))[0].outcome).toBe("cancelled");
  });
});
