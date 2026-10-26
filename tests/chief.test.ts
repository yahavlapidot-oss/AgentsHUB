import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-chief-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let hub: typeof import("../src/lib/tool-hub");
let runner: typeof import("../src/lib/runner/runner");
let actions: typeof import("../src/app/actions");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  hub = await import("../src/lib/tool-hub");
  runner = await import("../src/lib/runner/runner");
  actions = await import("../src/app/actions");
});

describe("chief of staff (HQ chat)", () => {
  it("needs a chief, then sends your messages to it in the HQ chat", async () => {
    await expect(actions.sendToChiefAction({ text: "hi" })).rejects.toThrow(/chief of staff/);
    const { agent: chief } = await data.createAgent({ name: "Chief", provider: "anthropic", model: "x", kind: "hosted" });
    await actions.setChiefAction(chief.id);
    expect((await data.getSnapshot()).chiefAgentId).toBe(chief.id);

    await actions.sendToChiefAction({ text: "מה המצב?" });
    const [msg] = await data.getMessages({ projectId: "hq" });
    expect(msg).toMatchObject({ text: "מה המצב?", toAgentId: chief.id, fromAgentId: null });
    expect((await data.getWakeMessages(chief.id, 0)).map((m) => m.id)).toContain(msg.id);
  });

  it("briefs the chief with every project and what waits on you", async () => {
    const chief = (await data.getAgents()).find((a) => a.name === "Chief")!;
    const project = await data.createProject({ name: "Website", goal: "Launch the new site" });
    await data.createTask({ title: "Write the landing copy", projectId: project.id, column: "in_progress" });
    const [agents, tasks, waiting] = await Promise.all([data.getAgents(), data.getTasks(), data.getMessages({ projectId: "hq" })]);
    const full = { ...chief, tokenHash: "" };
    const brief = await runner.inboxBrief(full, waiting, { agents, mine: [], names: new Map(agents.map((a) => [a.id, a.name])), tasks, hq: true });
    expect(brief).toContain("Website");
    expect(brief).toContain("Write the landing copy");
    expect(brief).toContain("No approvals waiting");
  });

  it("announces tasks and schedules it creates in the HQ chat", async () => {
    const chief = (await data.getAgents()).find((a) => a.name === "Chief")!;
    const tools = hub.toolsForAgent({ disabledTools: [] }, { sandbox: false });
    const ctx = { agent: chief, chatChannel: "hq", projectId: null };
    const exec = new hub.ToolExecutor(tools, ctx);
    const made = await exec.run({ id: "1", name: "create_task", args: { title: "Book a dentist appointment" } });
    expect(made.isError).toBeFalsy();
    const sched = await exec.run({ id: "2", name: "schedule_task", args: { title: "Morning brief", frequency: "daily", timeOfDay: "07:30" } });
    expect(sched.isError).toBeFalsy();
    const texts = (await data.getMessages({ projectId: "hq" })).map((m) => m.text);
    expect(texts).toContain("New task: Book a dentist appointment");
    expect(texts).toContain("New schedule: Morning brief (every day at 07:30)");
    // Agents can't schedule more often than hourly.
    const tooOften = await exec.run({ id: "3", name: "schedule_task", args: { title: "Spam", frequency: "minutes" } });
    expect(tooOften.isError).toBe(true);
  });
});
