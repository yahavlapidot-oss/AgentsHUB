import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-costs-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let budgets: typeof import("../src/lib/budgets");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  budgets = await import("../src/lib/budgets");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.NOTIFY_EMAIL;
  await budgets.setMonthlyCap(null);
});

/** A run on the task costing `model` in tokens plus `computer` of cloud computer time, the way the runner records it. */
async function spend(agentId: string, taskId: string, model: number, computer = 0) {
  const run = await data.startRun(agentId, { taskId, model: "claude-sonnet-5-5" });
  await data.addUsage(agentId, run.id, { tokensIn: 1000, tokensOut: 100, costUsd: model });
  if (computer) {
    const box = await data.createSandboxRecord({ agentId, taskId, runId: run.id, provider: "test" });
    await data.updateSandboxRecord(box.id, { status: "closed", costUsd: computer, endedAt: Date.now() });
    await data.addUsage(agentId, run.id, { tokensIn: 0, tokensOut: 0, costUsd: computer });
  }
  return run;
}

describe("costs", () => {
  it("splits spend into models and cloud computers, per project and per agent", async () => {
    const { agent } = await data.createAgent({ name: "Coster", provider: "anthropic", model: "x", kind: "hosted" });
    const project = await data.createProject({ name: "Shop" });
    const task = await data.createTask({ title: "Build cart", projectId: project.id });
    await spend(agent.id, task.id, 1.5, 0.5);
    await spend(agent.id, task.id, 1);

    const byProject = await budgets.getSpendByProject();
    expect(byProject.get(project.id)).toEqual({ total: 3, models: 2.5, computers: 0.5 });
    expect((await budgets.getComputerSpend("agent")).get(agent.id)).toBe(0.5);
    expect((await budgets.getComputerSpend("model")).get("claude-sonnet-5-5")).toBeGreaterThanOrEqual(0.5);
    const month = await budgets.getSpend(budgets.monthStart());
    expect(month.total).toBeGreaterThanOrEqual(3);
    expect(month.models + month.computers).toBeCloseTo(month.total);
  });

  it("stops at the project budget and emails once at 80%", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.NOTIFY_EMAIL = "me@example.com";
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const { agent } = await data.createAgent({ name: "Budgeted", provider: "anthropic", model: "x", kind: "hosted" });
    const project = await data.createProject({ name: "Capped", budgetUsd: 10 });
    const task = await data.createTask({ title: "Work", projectId: project.id });

    await spend(agent.id, task.id, 7);
    expect(await budgets.budgetProblem(task.id)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    await spend(agent.id, task.id, 1.5);
    expect(await budgets.budgetProblem(task.id)).toBeNull();
    expect(await budgets.budgetProblem(task.id)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body).subject).toContain("85% of the project \"Capped\"");

    // A running cloud computer counts before it's closed.
    expect(await budgets.budgetProblem(task.id, 2)).toMatch(/project "Capped" used up its budget of \$10.00/);

    // Raising the budget lets work go on.
    await data.updateProject(project.id, { budgetUsd: 50 });
    expect(await budgets.budgetProblem(task.id, 2)).toBeNull();
  });

  it("stops everything at the monthly cap", async () => {
    const { agent } = await data.createAgent({ name: "Monthly", provider: "anthropic", model: "x", kind: "hosted" });
    const task = await data.createTask({ title: "Anything" });
    await spend(agent.id, task.id, 0.1);
    const spent = (await budgets.getSpend(budgets.monthStart())).total;
    await budgets.setMonthlyCap(spent + 1);
    expect(await budgets.budgetProblem(task.id)).toBeNull();
    await spend(agent.id, task.id, 1);
    expect(await budgets.budgetProblem(task.id)).toMatch(/this month's spending cap/);
    expect((await budgets.getMonthStatus()).cap).toBe(spent + 1);
  });

  it("keeps the task's own budget", async () => {
    const { agent } = await data.createAgent({ name: "Tasky", provider: "anthropic", model: "x", kind: "hosted" });
    const task = await data.createTask({ title: "Small", budgetUsd: 1 });
    await spend(agent.id, task.id, 0.6);
    expect(await budgets.budgetProblem(task.id)).toBeNull();
    expect(await budgets.budgetProblem(task.id, 0.5)).toMatch(/task's budget of \$1.00/);
  });
});

describe("live workspace", () => {
  it("lists open runs with their commands, output and running cloud computer", async () => {
    const { getLiveWork } = await import("../src/lib/live-work");
    const { agent } = await data.createAgent({ name: "Live one", provider: "anthropic", model: "x", kind: "hosted" });
    const { agent: idle } = await data.createAgent({ name: "Idle one", provider: "anthropic", model: "x", kind: "hosted" });
    const task = await data.createTask({ title: "Run the tests" });
    const run = await data.startRun(agent.id, { taskId: task.id, model: "claude-sonnet-5-5" });
    const box = await data.createSandboxRecord({ agentId: agent.id, taskId: task.id, runId: run.id, provider: "test" });
    await data.updateSandboxRecord(box.id, { status: "running", addCommands: 1 });
    await data.addEvent({ agentId: agent.id, taskId: task.id, runId: run.id, type: "tool_call", payload: { text: "$ npm test → exit 0", output: "12 passed" } });
    await data.addEvent({ agentId: agent.id, taskId: task.id, runId: run.id, type: "note", payload: { text: "All green" } });

    const live = await getLiveWork(Date.now() + 60 * 60_000);
    const mine = live.runs.find((r) => r.run.id === run.id)!;
    expect(mine.agent?.name).toBe("Live one");
    expect(mine.task?.title).toBe("Run the tests");
    expect(mine.events.map((e) => (e.payload as { text: string }).text)).toEqual(["$ npm test → exit 0", "All green"]);
    expect(mine.sandbox?.commands).toBe(1);
    expect(mine.sandbox!.runningCostUsd).toBeGreaterThan(0);
    expect(live.idle.map((a) => a.id)).toContain(idle.id);

    await data.endRun(agent.id, run.id, "success");
    expect((await getLiveWork()).runs.find((r) => r.run.id === run.id)).toBeUndefined();
  });
});
