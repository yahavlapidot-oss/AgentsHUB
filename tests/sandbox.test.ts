import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxMachine, SandboxProvider } from "../src/lib/sandbox/provider";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-sbx-")), "test.db")}`;

// A scripted model, as in the integration tests.
const script: { calls: { name: string; args: unknown }[] }[] = [];
vi.mock("../src/lib/runner/providers", () => ({
  MissingKeyError: class extends Error {},
  createChat: (opts: { tools: { name: string }[]; system: string }) => {
    seen.tools = opts.tools.map((t) => t.name);
    seen.system = opts.system;
    return {
      send: async () => {
        const step = script.shift() ?? { calls: [] };
        return {
          text: "",
          model: "claude-sonnet-5-5",
          usage: { tokensIn: 1000, tokensOut: 100 },
          toolCalls: step.calls.map((c, i) => ({ id: `call_${i}`, ...c })),
        };
      },
    };
  },
}));
const seen: { tools: string[]; system: string } = { tools: [], system: "" };

/** An in-memory stand-in for E2B: a file map and a log of commands. */
class FakeMachine implements SandboxMachine {
  files = new Map<string, Uint8Array>();
  commands: string[] = [];
  closed = false;
  constructor(readonly externalId: string) {}
  async run(cmd: string) {
    this.commands.push(cmd);
    if (cmd === "npm test") return { exitCode: 1, stdout: "", stderr: "1 failing" };
    return { exitCode: 0, stdout: `ran ${cmd}`, stderr: "" };
  }
  async start(cmd: string) {
    this.commands.push(`bg: ${cmd}`);
    return { pid: 42 };
  }
  async writeFile(path: string, content: string | Uint8Array) {
    this.files.set(path, typeof content === "string" ? new TextEncoder().encode(content) : content);
  }
  async readFile(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error(`file not found: ${path}`);
    return f;
  }
  async list() {
    return [...this.files.entries()].map(([path, c]) => ({ name: path.split("/").pop()!, path, type: "file" as const, size: c.length }));
  }
  previewUrl(port: number) {
    return `https://${port}-${this.externalId}.fake.dev`;
  }
  async close() {
    this.closed = true;
  }
}

class FakeProvider implements SandboxProvider {
  readonly name = "fake";
  machines: FakeMachine[] = [];
  killed: string[] = [];
  available() {
    return true;
  }
  async create() {
    const m = new FakeMachine(`fake_${this.machines.length + 1}`);
    this.machines.push(m);
    return m;
  }
  async kill(id: string) {
    this.killed.push(id);
  }
}

let data: typeof import("../src/lib/data");
let runner: typeof import("../src/lib/runner/runner");
let session: typeof import("../src/lib/sandbox/session");
let sandboxTools: typeof import("../src/lib/sandbox/tools");
let provider: FakeProvider;

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  runner = await import("../src/lib/runner/runner");
  session = await import("../src/lib/sandbox/session");
  sandboxTools = await import("../src/lib/sandbox/tools");
});

beforeEach(async () => {
  provider = new FakeProvider();
  (await import("../src/lib/sandbox/provider")).setSandboxProvider(provider);
  script.length = 0;
});

const hosted = async (id: string) => (await data.getHostedAgents()).find((a) => a.id === id)!;

describe("coder agent with a cloud computer", () => {
  it("writes code, runs it, saves the file and closes the sandbox", async () => {
    const { agent } = await data.createAgent({
      name: "Coder",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      kind: "hosted",
      sandboxEnabled: true,
    });
    const task = await data.createTask({ title: "Write a hello script", ownerAgentId: agent.id, column: "ready" });
    script.push(
      { calls: [{ name: "write_file", args: { path: "hello.js", content: "console.log('hi')" } }] },
      { calls: [{ name: "run_command", args: { command: "node hello.js" } }, { name: "run_command", args: { command: "rm -rf build" } }] },
      { calls: [{ name: "save_artifact", args: { path: "hello.js", note: "The script" } }] },
      { calls: [{ name: "complete_task", args: { taskId: task.id, summary: "Ran node hello.js; it prints hi." } }] },
    );
    await runner.runTask(await hosted(agent.id), task);

    expect(seen.tools).toEqual(expect.arrayContaining(["run_command", "write_file", "save_artifact", "preview_url"]));
    expect(seen.system).toContain("cloud computer");

    // One machine, opened on first use; the throwaway "rm -rf" ran without asking.
    expect(provider.machines).toHaveLength(1);
    const machine = provider.machines[0];
    expect(machine.commands[0]).toBe("mkdir -p /home/user/work");
    // The saved state is committed to git, so the agent can diff its own changes.
    expect(machine.commands[1]).toMatch(/^git init -q .* git commit /);
    expect(machine.commands.slice(2)).toEqual(["node hello.js", "rm -rf build"]);
    expect(machine.closed).toBe(true);

    const [art] = await data.getArtifacts({ taskId: task.id });
    expect(art).toMatchObject({ path: "hello.js", version: 1, kind: "code", note: "The script", agentId: agent.id });
    expect((await data.getArtifact(art.id))?.content.toString()).toBe("console.log('hi')");

    const [sbx] = await data.getSandboxes({ taskId: task.id });
    expect(sbx).toMatchObject({ status: "closed", provider: "fake", externalId: "fake_1", commands: 2 });
    expect((await data.getTask(task.id))?.column).toBe("review");
    expect(await data.getOpenSandboxes()).toHaveLength(0);
  });

  it("restores the task's saved files when a later run opens a new sandbox", async () => {
    const { agent } = await data.createAgent({ name: "Resumer", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted", sandboxEnabled: true });
    const task = await data.createTask({ title: "Continue the app", ownerAgentId: agent.id, column: "ready" });
    await data.saveArtifact({ taskId: task.id, agentId: agent.id, path: "app/index.html", content: Buffer.from("<h1>v1</h1>") });
    script.push(
      { calls: [{ name: "read_file", args: { path: "app/index.html" } }] },
      { calls: [{ name: "complete_task", args: { taskId: task.id, summary: "done" } }] },
    );
    await runner.runTask(await hosted(agent.id), task);
    const machine = provider.machines[0];
    expect(new TextDecoder().decode(machine.files.get("/home/user/work/app/index.html"))).toBe("<h1>v1</h1>");
  });

  it("starts a project task from the project's shared workspace, saved by other tasks and agents", async () => {
    const project = await data.createProject({ name: "Portal" });
    const { agent: first } = await data.createAgent({ name: "First", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted" });
    const { agent: next } = await data.createAgent({ name: "Next", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted", sandboxEnabled: true });
    const earlier = await data.createTask({ title: "Scaffold", projectId: project.id });
    await data.saveArtifact({ taskId: earlier.id, agentId: first.id, path: "src/app.ts", content: Buffer.from("v1") });
    await data.saveArtifact({ taskId: earlier.id, agentId: first.id, path: "src/app.ts", content: Buffer.from("v2") });
    const task = await data.createTask({ title: "Add login", projectId: project.id, ownerAgentId: next.id, column: "ready" });
    script.push(
      { calls: [{ name: "list_files", args: {} }] },
      { calls: [{ name: "complete_task", args: { taskId: task.id, summary: "done" } }] },
    );
    await runner.runTask(await hosted(next.id), task);
    const machine = provider.machines[0];
    expect(new TextDecoder().decode(machine.files.get("/home/user/work/src/app.ts"))).toBe("v2");
  });

  it("doesn't open a sandbox for a run that never uses one, and hides the tools when it's off", async () => {
    const { agent } = await data.createAgent({ name: "Writer", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted", sandboxEnabled: true });
    const task = await data.createTask({ title: "Write a haiku", ownerAgentId: agent.id, column: "ready" });
    script.push({ calls: [{ name: "complete_task", args: { taskId: task.id, summary: "Autumn moon…" } }] });
    await runner.runTask(await hosted(agent.id), task);
    expect(provider.machines).toHaveLength(0);
    expect(await data.getSandboxes({ taskId: task.id })).toHaveLength(0);

    const { agent: plain } = await data.createAgent({ name: "Plain", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted" });
    const t2 = await data.createTask({ title: "Plain task", ownerAgentId: plain.id, column: "ready" });
    script.push({ calls: [{ name: "complete_task", args: { taskId: t2.id, summary: "ok" } }] });
    await runner.runTask(await hosted(plain.id), t2);
    expect(seen.tools).not.toContain("run_command");
    expect(seen.tools).toContain("save_artifact");
    expect(seen.system).toContain("no file system");
  });

  it("asks before pushing from the sandbox", async () => {
    const { agent } = await data.createAgent({ name: "Pusher", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted", sandboxEnabled: true });
    const task = await data.createTask({ title: "Ship it", ownerAgentId: agent.id });
    const run = await data.startRun(agent.id, { taskId: task.id, model: "x" });
    const sandbox = new session.SandboxSession({ agentId: agent.id, taskId: task.id, runId: run.id });
    const runCommand = sandboxTools.SANDBOX_TOOLS.find((t) => t.name === "run_command")!;
    const res = (await runCommand.run({ command: "git push origin main" }, { agent, taskId: task.id, sandbox })) as { ran: boolean; decision: string };
    expect(res).toMatchObject({ ran: false, decision: "ask" });
    expect(provider.machines).toHaveLength(0);
    const [approval] = await data.getApprovals({ pendingOnly: true });
    expect(approval.action).toBe("Sandbox: git push origin main");
    await sandbox.close();
  });

  it("stops the run when the task's budget is used up", async () => {
    const { agent } = await data.createAgent({ name: "Spender", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted", sandboxEnabled: true });
    // Each scripted turn costs (1000 * 2 + 100 * 10) / 1e6 = $0.003.
    const task = await data.createTask({ title: "Cheap task", ownerAgentId: agent.id, column: "ready", budgetUsd: 0.005 });
    script.push(
      { calls: [{ name: "run_command", args: { command: "npm test" } }] },
      { calls: [{ name: "run_command", args: { command: "npm test" } }] },
      { calls: [{ name: "run_command", args: { command: "npm test" } }] },
    );
    await runner.runTask(await hosted(agent.id), task);
    expect((await data.getTask(task.id))?.column).toBe("waiting_on_you");
    const errors = (await data.getEvents({ taskId: task.id })).filter((e) => e.type === "error");
    expect(String(errors[0]?.payload.text)).toContain("budget");
    expect(provider.machines[0].closed).toBe(true);
    expect((await data.getRuns({ agentId: agent.id }))[0].outcome).toBe("failed");
  });

  it("keeps paths inside the work folder", () => {
    expect(session.resolvePath("src/../app.js")).toBe("/home/user/work/app.js");
    expect(session.resolvePath("/tmp/x")).toBe("/tmp/x");
    expect(() => session.resolvePath("../../../etc/passwd")).toThrow();
    expect(() => session.resolvePath("/etc/passwd")).toThrow();
  });

  it("closes sandboxes left open by a crashed server", async () => {
    const { agent } = await data.createAgent({ name: "Ghost", provider: "anthropic", model: "x", kind: "hosted" });
    const rec = await data.createSandboxRecord({ agentId: agent.id, taskId: null, runId: null, provider: "fake" });
    await data.updateSandboxRecord(rec.id, { externalId: "fake_orphan", status: "running" });
    expect(await session.reapOrphanedSandboxes()).toBe(1);
    expect(provider.killed).toEqual(["fake_orphan"]);
    expect(await data.getOpenSandboxes()).toHaveLength(0);
  });
});

describe("artifacts", () => {
  it("versions files by task and path, and skips identical saves", async () => {
    const task = await data.createTask({ title: "Docs" });
    const a = await data.saveArtifact({ taskId: task.id, agentId: null, path: "/home/user/work/docs/readme.md", content: Buffer.from("one") });
    const same = await data.saveArtifact({ taskId: task.id, agentId: null, path: "docs/readme.md", content: Buffer.from("one") });
    const b = await data.saveArtifact({ taskId: task.id, agentId: null, path: "docs/readme.md", content: Buffer.from("two") });
    expect(a.artifact).toMatchObject({ path: "docs/readme.md", version: 1, kind: "document", mimeType: "text/markdown" });
    expect(same).toMatchObject({ unchanged: true, artifact: { id: a.artifact.id } });
    expect(b.artifact.version).toBe(2);
    expect(await data.getArtifacts({ taskId: task.id, latestOnly: true })).toHaveLength(1);
    expect(await data.getArtifacts({ taskId: task.id })).toHaveLength(2);
  });

  it("rejects files over the size limit", async () => {
    const task = await data.createTask({ title: "Big" });
    await expect(
      data.saveArtifact({ taskId: task.id, agentId: null, path: "big.bin", content: Buffer.alloc(data.MAX_ARTIFACT_BYTES + 1) }),
    ).rejects.toThrow(data.ArtifactError);
  });

  it("lets agents without a sandbox save text", async () => {
    const { agent } = await data.createAgent({ name: "Doc writer", provider: "anthropic", model: "x", kind: "mcp" });
    const task = await data.createTask({ title: "Write the spec" });
    const { findTool } = await import("../src/lib/agent-tools");
    const res = (await findTool("save_artifact")!.run({ taskId: task.id, name: "spec.md", content: "# Spec" }, { agent })) as {
      artifact: { path: string };
      link: string;
    };
    expect(res.artifact.path).toBe("spec.md");
    expect(res.link).toContain("/api/ui/artifacts/");
    await expect(findTool("save_artifact")!.run({ taskId: task.id, path: "x.md" }, { agent })).rejects.toThrow("no cloud computer");
  });
});
