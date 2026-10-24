import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Point the app at a throwaway database before anything imports it.
process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let tokens: typeof import("../src/lib/tokens");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  tokens = await import("../src/lib/tokens");
});

describe("agent tokens", () => {
  it("finds an agent by its token and never by a wrong one", async () => {
    const { agent, token } = await data.createAgent({ name: "A", provider: "anthropic", model: "claude-sonnet-5-5" });
    expect((await data.findAgentByToken(token))?.id).toBe(agent.id);
    expect(await data.findAgentByToken(token + "x")).toBeNull();
    expect(agent).not.toHaveProperty("tokenHash");
  });

  it("stops accepting the old token after rotation", async () => {
    const { agent, token } = await data.createAgent({ name: "B", provider: "openai", model: "gpt-5" });
    const fresh = await data.rotateAgentToken(agent.id);
    expect(await data.findAgentByToken(token)).toBeNull();
    expect((await data.findAgentByToken(fresh))?.id).toBe(agent.id);
  });

  it("only accepts ahub_ bearer tokens", () => {
    expect(tokens.bearerToken("Bearer ahub_abc")).toBe("ahub_abc");
    expect(tokens.bearerToken("Bearer sk-ant-123")).toBeNull();
    expect(tokens.bearerToken(null)).toBeNull();
  });
});

describe("task flow", () => {
  it("claims, reports progress, and refuses a second owner", async () => {
    const a = await data.createAgent({ name: "C", provider: "google", model: "gemini-2.5-pro" });
    const b = await data.createAgent({ name: "D", provider: "anthropic", model: "claude-haiku-5-5" });
    const task = await data.createTask({ title: "Write docs" });
    expect(task.column).toBe("backlog");

    const claimed = await data.claimTask(a.agent.id, task.id);
    expect(claimed?.column).toBe("in_progress");
    expect(claimed?.ownerAgentId).toBe(a.agent.id);
    await expect(data.claimTask(b.agent.id, task.id)).rejects.toThrow(/already owned/);

    const moved = await data.reportProgress(a.agent.id, task.id, { progressPct: 140, note: "almost" });
    expect(moved?.progressPct).toBe(100);

    const events = await data.getEvents({ taskId: task.id });
    expect(events.some((e) => e.type === "status_change")).toBe(true);
    expect(events.some((e) => e.type === "note" && e.payload.text === "almost")).toBe(true);
  });

  it("moves a task to Waiting on you during an approval and back after", async () => {
    const { agent } = await data.createAgent({ name: "E", provider: "anthropic", model: "claude-opus-5-5" });
    const task = await data.createTask({ title: "Deploy", ownerAgentId: agent.id });
    await data.claimTask(agent.id, task.id);
    const approval = await data.requestApproval(agent.id, { taskId: task.id, action: "Deploy to prod", risk: "high" });

    expect((await data.getTask(task.id))?.column).toBe("waiting_on_you");
    expect((await data.getAgent(agent.id))?.status).toBe("waiting");

    await data.decideApproval(approval.id, "approved");
    expect((await data.getTask(task.id))?.column).toBe("in_progress");
    expect((await data.getAgent(agent.id))?.status).toBe("active");
    // Deciding twice does nothing.
    expect(await data.decideApproval(approval.id, "denied")).toBeNull();
  });
});

describe("usage", () => {
  it("adds run usage to the agent totals", async () => {
    const { agent } = await data.createAgent({ name: "F", provider: "openai", model: "gpt-5-mini" });
    await data.recordUsage(agent.id, { model: "gpt-5-mini", tokensIn: 1000, tokensOut: 200, costUsd: 0.01 });
    const run = await data.startRun(agent.id, { model: "gpt-5-mini" });
    await data.addUsage(agent.id, run.id, { tokensIn: 500, tokensOut: 50 });

    const after = await data.getAgent(agent.id);
    expect(after?.tokensIn).toBe(1500);
    expect(after?.tokensOut).toBe(250);
    expect(after?.costUsd).toBeCloseTo(0.01);

    const byModel = await data.getUsage("model");
    expect(byModel.find((r) => r.key === "gpt-5-mini")?.runs).toBe(2);
  });

  it("shows an agent with no recent heartbeat as offline", async () => {
    const { agent } = await data.createAgent({ name: "G", provider: "custom", model: "local-llama" });
    expect((await data.getAgent(agent.id))?.status).toBe("offline");
    await data.heartbeat(agent.id);
    expect((await data.getAgent(agent.id))?.status).toBe("active");
  });
});

describe("commands", () => {
  it("delivers each command once and pauses the agent", async () => {
    const { agent } = await data.createAgent({ name: "H", provider: "anthropic", model: "claude-sonnet-5-5" });
    await data.heartbeat(agent.id);
    await data.sendCommand(agent.id, "pause");
    expect((await data.getAgent(agent.id))?.status).toBe("paused");
    // A heartbeat does not un-pause.
    await data.heartbeat(agent.id, { status: "active" });
    expect((await data.getAgent(agent.id))?.status).toBe("paused");

    expect(await data.takePendingCommands(agent.id)).toHaveLength(1);
    expect(await data.takePendingCommands(agent.id)).toHaveLength(0);
  });
});
