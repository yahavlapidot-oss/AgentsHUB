import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-proj-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let tools: typeof import("../src/lib/agent-tools");
let runner: typeof import("../src/lib/runner/runner");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  tools = await import("../src/lib/agent-tools");
  runner = await import("../src/lib/runner/runner");
});

const agentNamed = async (name: string) => (await data.createAgent({ name, provider: "anthropic", model: "x", kind: "hosted" })).agent;

describe("projects", () => {
  it("keeps one version history per path across the project's tasks", async () => {
    const project = await data.createProject({ name: "Shared" });
    const a = await agentNamed("Writer A");
    const b = await agentNamed("Writer B");
    const t1 = await data.createTask({ title: "Part 1", projectId: project.id });
    const t2 = await data.createTask({ title: "Part 2", projectId: project.id });
    await data.saveArtifact({ taskId: t1.id, agentId: a.id, path: "README.md", content: Buffer.from("one") });
    const { artifact } = await data.saveArtifact({ taskId: t2.id, agentId: b.id, path: "README.md", content: Buffer.from("two") });
    expect(artifact).toMatchObject({ version: 2, projectId: project.id });
    const workspace = await data.getArtifacts({ projectId: project.id, latestOnly: true });
    expect(workspace.map((f) => [f.path, f.version, f.agentId])).toEqual([["README.md", 2, b.id]]);

    // Subtasks inherit the project.
    const sub = await data.createTask({ title: "Sub", parentTaskId: t1.id });
    expect(sub.projectId).toBe(project.id);

    // Agents read shared files without a cloud computer.
    const res = (await tools.findTool("read_saved_file")!.run({ taskId: t1.id, path: "README.md" }, { agent: a })) as { content: string; version: number };
    expect(res).toMatchObject({ content: "two", version: 2 });
  });

  it("lets only members take tasks and change files, and skips paused projects", async () => {
    const member = await agentNamed("Member");
    const outsider = await agentNamed("Outsider");
    const project = await data.createProject({ name: "Private", memberAgentIds: [member.id] });
    const task = await data.createTask({ title: "Members only", projectId: project.id, column: "ready" });

    expect((await runner.pickTask({ id: outsider.id, role: "member" }))?.id).not.toBe(task.id);
    await expect(data.claimTask(outsider.id, task.id)).rejects.toThrow(/Only members/);
    await expect(data.saveArtifact({ taskId: task.id, agentId: outsider.id, path: "x.md", content: Buffer.from("x") })).rejects.toThrow(/Only members/);
    expect((await runner.pickTask({ id: member.id, role: "member" }))?.id).toBe(task.id);

    await data.updateProject(project.id, { status: "paused" });
    expect((await runner.pickTask({ id: member.id, role: "member" }))?.id).not.toBe(task.id);
  });

  it("hands a task off with a note that leads the next owner's brief", async () => {
    const project = await data.createProject({ name: "Handoff", goal: "Ship the invoices page", context: "TypeScript only." });
    const from = await agentNamed("Starter");
    const to = await agentNamed("Finisher");
    const task = await data.createTask({ title: "Invoices page", projectId: project.id, ownerAgentId: from.id, column: "in_progress" });
    await data.saveArtifact({ taskId: task.id, agentId: from.id, path: "src/invoices.ts", content: Buffer.from("export {}") });

    const handOff = tools.findTool("hand_off")!;
    await expect(handOff.run({ taskId: task.id, toAgentId: to.id, note: "too short" }, { agent: from })).rejects.toThrow();
    await expect(handOff.run({ taskId: task.id, toAgentId: from.id, note: "Done: the API. Left: the table UI." }, { agent: to })).rejects.toThrow(/owner/);
    await handOff.run({ taskId: task.id, toAgentId: to.id, note: "Done: the API in src/invoices.ts. Left: the table UI. Tests pass." }, { agent: from });

    const moved = (await data.getTask(task.id))!;
    expect(moved).toMatchObject({ ownerAgentId: to.id, column: "ready" });
    const inbox = await data.getInbox(to.id, 0);
    expect(inbox.at(-1)?.text).toContain("Left: the table UI");

    const brief = await runner.brief((await data.getHostedAgents()).find((a) => a.id === to.id)!, moved);
    expect(brief).toContain("Starter handed this task to you");
    expect(brief).toContain("Ship the invoices page");
    expect(brief).toContain("TypeScript only.");
    expect(brief).toContain("src/invoices.ts (v1");
  });

  it("moves a task's files along when the task changes project, and frees them when a project is deleted", async () => {
    const p1 = await data.createProject({ name: "One" });
    const p2 = await data.createProject({ name: "Two" });
    const task = await data.createTask({ title: "Mover", projectId: p1.id });
    await data.saveArtifact({ taskId: task.id, agentId: null, path: "m.txt", content: Buffer.from("m") });
    await data.updateTask(task.id, { projectId: p2.id });
    expect((await data.getArtifacts({ projectId: p2.id })).map((f) => f.path)).toEqual(["m.txt"]);
    await data.deleteProject(p2.id);
    expect((await data.getTask(task.id))?.projectId).toBeNull();
    expect((await data.getArtifacts({ taskId: task.id }))[0].projectId).toBeNull();
  });
});
