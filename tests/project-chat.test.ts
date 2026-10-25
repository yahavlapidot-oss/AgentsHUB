import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-chat-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let tools: typeof import("../src/lib/agent-tools");
let runner: typeof import("../src/lib/runner/runner");
let actions: typeof import("../src/app/actions");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  tools = await import("../src/lib/agent-tools");
  runner = await import("../src/lib/runner/runner");
  actions = await import("../src/app/actions");
});

const agentNamed = async (name: string, role: "member" | "lead" = "member") =>
  (await data.createAgent({ name, provider: "anthropic", model: "x", kind: "hosted", role })).agent;

describe("project chat with the work manager", () => {
  it("uses the picked manager, else a team lead who may work on the project", async () => {
    const lead = await agentNamed("Team lead", "lead");
    const dev = await agentNamed("Dev");
    const open = await data.createProject({ name: "Open" });
    expect(data.projectLead(open, await data.getAgents())?.id).toBe(lead.id);

    const closed = await data.createProject({ name: "Closed", memberAgentIds: [dev.id] });
    expect(data.projectLead(closed, await data.getAgents())).toBeNull();

    // Picking a manager makes it a member, so it may work on the project.
    const other = await agentNamed("Manager");
    const updated = await data.updateProject(closed.id, { leadAgentId: other.id });
    expect(updated?.memberAgentIds.sort()).toEqual([dev.id, other.id].sort());
    expect(data.projectLead(updated!, await data.getAgents())?.id).toBe(other.id);

    // Deleting the agent clears it as manager.
    await data.deleteAgent(other.id);
    expect((await data.getProject(closed.id))?.leadAgentId).toBeNull();
  });

  it("turns a chat line into a task for the manager and keeps both in the project chat", async () => {
    const manager = await agentNamed("PM");
    const project = await data.createProject({ name: "Shop", leadAgentId: manager.id });
    const { taskId } = await actions.sendToLeadAction(project.id, { text: "Add a pricing page\nThree plans, monthly and yearly", asTask: true, priority: "high" });
    const task = await data.getTask(taskId!);
    expect(task).toMatchObject({ title: "Add a pricing page", description: "Three plans, monthly and yearly", priority: "high", projectId: project.id, ownerAgentId: manager.id, column: "ready" });

    await actions.sendToLeadAction(project.id, { text: "What's the status?" });
    const chat = await data.getMessages({ projectId: project.id });
    expect(chat.map((m) => [m.text, m.toAgentId, m.taskId])).toEqual([
      ["Add a pricing page\nThree plans, monthly and yearly", manager.id, task!.id],
      ["What's the status?", manager.id, null],
    ]);
    // A plain message wakes the manager.
    expect((await data.getWakeMessages(manager.id, 0)).map((m) => m.text)).toContain("What's the status?");
    expect((await runner.pickTask(manager))?.id).toBe(task!.id);
  });

  it("refuses when the project has no manager", async () => {
    const dev = await agentNamed("Solo");
    const project = await data.createProject({ name: "Nobody runs it", memberAgentIds: [dev.id] });
    await expect(actions.sendToLeadAction(project.id, { text: "Hi" })).rejects.toThrow(/work manager/);
  });

  it("answers and creates tasks in the project the manager was woken from", async () => {
    const manager = await agentNamed("Chat PM");
    const project = await data.createProject({ name: "App", leadAgentId: manager.id });
    const ctx = { agent: manager, projectId: project.id };
    await tools.findTool("send_message")!.run({ text: "On it" }, ctx);
    const res = (await tools.findTool("create_task")!.run({ title: "Build the login" }, ctx)) as { task: { id: string } };
    expect((await data.getTask(res.task.id))?.projectId).toBe(project.id);
    const chat = await data.getMessages({ projectId: project.id });
    expect(chat.map((m) => [m.fromAgentId, m.text, m.taskId])).toEqual([
      [manager.id, "On it", null],
      [manager.id, "New task: Build the login", res.task.id],
    ]);
  });

  it("leaves a project's new tasks for its manager while it's online", async () => {
    const manager = await agentNamed("Planner");
    const dev = await agentNamed("Builder");
    const project = await data.createProject({ name: "Planned", leadAgentId: manager.id, memberAgentIds: [dev.id] });
    const task = await data.createTask({ title: "Big feature", projectId: project.id, column: "ready", priority: "critical" });
    await data.heartbeat(manager.id, {});
    expect((await runner.pickTask(dev))?.id).not.toBe(task.id);
    expect((await runner.pickTask(manager))?.id).toBe(task.id);
  });

  it("briefs the manager with the project's tasks and the chat so far", async () => {
    const manager = await agentNamed("Briefed PM");
    const dev = await agentNamed("Briefed dev");
    const project = await data.createProject({ name: "Briefed", goal: "Ship v1", leadAgentId: manager.id, memberAgentIds: [dev.id] });
    await data.createTask({ title: "Write tests", projectId: project.id, ownerAgentId: dev.id });
    await actions.sendToLeadAction(project.id, { text: "Earlier question" });
    await actions.sendToLeadAction(project.id, { text: "How is it going?" });
    const all = await data.getMessages({ projectId: project.id });
    const agents = await data.getAgents();
    const text = await runner.inboxBrief(manager, all.slice(-1), {
      agents,
      mine: [],
      names: new Map(agents.map((a) => [a.id, a.name])),
      project,
      tasks: await data.getTasks(),
    });
    expect(text).toContain("How is it going?");
    expect(text).toContain("Earlier question");
    expect(text).toContain("Ship v1");
    expect(text).toMatch(/Write tests .*Briefed dev/);
  });
});
