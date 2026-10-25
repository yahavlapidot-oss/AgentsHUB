/**
 * The board's tools, as agents see them. One definition serves both the MCP
 * endpoint (/api/mcp, for Claude Code, Codex and other MCP clients) and the
 * hosted runner (Claude, GPT and Gemini driven by AgentsHUB itself).
 *
 * Schemas stay inside the JSON Schema subset all three providers accept:
 * type, properties, required, items, enum, description.
 */
import { z } from "zod";
import { gateAction, type GateResult } from "./control";
import {
  addEvent,
  ArtifactError,
  claimTask,
  createTask,
  forgetAgentMemory,
  getAgentMemories,
  getArtifact,
  getLastHandoff,
  getProject,
  getProjects,
  handOffTask,
  isProjectMember,
  normalizeArtifactPath,
  getAgents,
  getArtifacts,
  getEvents,
  getInbox,
  getMessages,
  getNotes,
  getTask,
  getTasks,
  heartbeat,
  postMessage,
  rememberForAgent,
  reportProgress,
  saveArtifact,
  setArtifactStatus,
  takePendingCommands,
  writeNote,
} from "./data";
import { MEMORY_SOURCES, searchMemory } from "./memory";
import { boardLink, notifyByEmail } from "./notify";
import { COLUMNS, PRIORITIES, type Agent } from "./schema";
import type { SandboxSession } from "./sandbox/session";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type ToolContext = {
  agent: Pick<Agent, "id" | "name">;
  /** Hosted agents wait for the user's decision inside request_approval; MCP clients poll. */
  waitForApproval?: (gate: GateResult) => Promise<GateResult>;
  /** Hosted runs: the task and run being worked on. */
  taskId?: string | null;
  runId?: string | null;
  /** Hosted agents with a cloud computer. */
  sandbox?: SandboxSession;
};

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run: (args: unknown, ctx: ToolContext) => Promise<unknown>;
};

export function tool<S extends z.ZodTypeAny>(def: {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  args: S;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}): AgentTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    run: async (raw, ctx) => {
      const parsed = def.args.safeParse(raw ?? {});
      if (!parsed.success) throw new ToolInputError(JSON.stringify(parsed.error.flatten().fieldErrors));
      return def.run(parsed.data, ctx);
    },
  };
}

export class ToolInputError extends Error {}

export const str = (description: string) => ({ type: "string", description });

const compactTask = (t: Awaited<ReturnType<typeof getTasks>>[number]) => ({
  id: t.id,
  title: t.title,
  column: t.column,
  priority: t.priority,
  ownerAgentId: t.ownerAgentId,
  parentTaskId: t.parentTaskId,
  projectId: t.projectId,
  dependsOn: t.dependsOn,
  progressPct: t.progressPct,
});

const fileInfo = (a: { path: string; version: number; sizeBytes: number; agentId: string | null; taskId: string | null; createdAt: number }) => ({
  path: a.path,
  version: a.version,
  sizeBytes: a.sizeBytes,
  savedBy: a.agentId ?? "user",
  taskId: a.taskId,
  savedAt: a.createdAt,
});

const isText = (mime: string) => mime.startsWith("text/") || /json|javascript|typescript|xml|yaml|svg|csv|markdown/.test(mime);

export const AGENT_TOOLS: AgentTool[] = [
  tool({
    name: "list_tasks",
    description:
      "List tasks on the board. Use mine=true for your own tasks, or column='ready' to find work nobody has taken yet.",
    inputSchema: {
      type: "object",
      properties: {
        column: { type: "string", enum: [...COLUMNS], description: "Only tasks in this column" },
        mine: { type: "boolean", description: "Only tasks you own" },
        projectId: str("Only tasks in this project (optional)"),
      },
    },
    args: z.object({ column: z.enum(COLUMNS).optional(), mine: z.boolean().optional(), projectId: z.string().optional() }),
    run: async ({ column, mine, projectId }, { agent }) => {
      const all = await getTasks();
      const tasks = all.filter(
        (t) => (!mine || t.ownerAgentId === agent.id) && (!column || t.column === column) && (!projectId || t.projectId === projectId),
      );
      return { tasks: tasks.slice(0, 100).map(compactTask) };
    },
  }),

  tool({
    name: "get_task",
    description:
      "Full details of one task: description, acceptance criteria, its project (goal, requirements, shared files), the last handoff note, recent activity and chat.",
    inputSchema: { type: "object", properties: { taskId: str("Task id") }, required: ["taskId"] },
    args: z.object({ taskId: z.string() }),
    run: async ({ taskId }) => {
      const task = await getTask(taskId);
      if (!task) throw new ToolInputError(`No task ${taskId}`);
      const [activity, chat, all, project, handoff, files] = await Promise.all([
        getEvents({ taskId, limit: 30 }),
        getMessages({ taskId, limit: 30 }),
        getTasks(),
        task.projectId ? getProject(task.projectId) : null,
        getLastHandoff(taskId),
        getArtifacts(task.projectId ? { projectId: task.projectId, latestOnly: true, limit: 5_000 } : { taskId, latestOnly: true }),
      ]);
      const subtasks = all.filter((t) => t.parentTaskId === taskId).map(compactTask);
      return {
        task,
        project: project && { id: project.id, name: project.name, goal: project.goal, context: project.context },
        handoff,
        files: files.map(fileInfo),
        subtasks,
        activity,
        chat,
      };
    },
  }),

  tool({
    name: "list_agents",
    description: "The other agents on the board, with their skills and status. Use it to decide who should take a subtask.",
    inputSchema: { type: "object", properties: {} },
    args: z.object({}).passthrough(),
    run: async () => {
      const agents = await getAgents();
      return {
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          model: a.model,
          skills: a.skills,
          status: a.status,
          currentTaskId: a.currentTaskId,
        })),
      };
    },
  }),

  tool({
    name: "claim_task",
    description: "Take a task: you become its owner and it moves to In progress. Fails if another agent owns it.",
    inputSchema: { type: "object", properties: { taskId: str("Task id") }, required: ["taskId"] },
    args: z.object({ taskId: z.string() }),
    run: async ({ taskId }, { agent }) => {
      const task = await getTask(taskId);
      if (!task) throw new ToolInputError(`No task ${taskId}`);
      const blocked = await unfinishedDependencies(task.dependsOn);
      if (blocked.length) throw new ToolInputError(`Task depends on unfinished tasks: ${blocked.join(", ")}`);
      return { task: await claimTask(agent.id, taskId) };
    },
  }),

  tool({
    name: "create_subtasks",
    description:
      "Split a task into smaller tasks. Give each a clear title and acceptance criteria. Set ownerAgentId to hand one to a specific agent, or leave it empty so any agent can take it. Use dependsOnPrevious when a subtask needs the one before it.",
    inputSchema: {
      type: "object",
      properties: {
        parentTaskId: str("The task being split"),
        subtasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: str("Short title"),
              description: str("What to do"),
              acceptanceCriteria: str("How we know it's done"),
              ownerAgentId: str("Agent to assign, from list_agents (optional)"),
              priority: { type: "string", enum: [...PRIORITIES] },
              dependsOnPrevious: { type: "boolean", description: "Wait for the previous subtask in this list" },
            },
            required: ["title"],
          },
        },
      },
      required: ["parentTaskId", "subtasks"],
    },
    args: z.object({
      parentTaskId: z.string(),
      subtasks: z
        .array(
          z.object({
            title: z.string().min(1).max(300),
            description: z.string().max(10_000).optional(),
            acceptanceCriteria: z.string().max(5_000).optional(),
            ownerAgentId: z.string().optional(),
            priority: z.enum(PRIORITIES).optional(),
            dependsOnPrevious: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
    run: async ({ parentTaskId, subtasks }, { agent }) => {
      const parent = await getTask(parentTaskId);
      if (!parent) throw new ToolInputError(`No task ${parentTaskId}`);
      const created = [];
      let previous: string | null = null;
      for (const s of subtasks) {
        const task = await createTask({
          title: s.title,
          description: s.description,
          acceptanceCriteria: s.acceptanceCriteria,
          ownerAgentId: s.ownerAgentId || null,
          priority: s.priority ?? parent.priority,
          parentTaskId,
          column: "ready",
          dependsOn: s.dependsOnPrevious && previous ? [previous] : [],
          createdBy: agent.id,
        });
        created.push(compactTask(task));
        previous = task.id;
      }
      await addEvent({
        agentId: agent.id,
        taskId: parentTaskId,
        type: "note",
        payload: { text: `Split into ${created.length} subtasks`, subtasks: created.map((c) => c.title) },
      });
      return { subtasks: created };
    },
  }),

  tool({
    name: "create_task",
    description:
      "Add a new task to the board, for work that isn't part of an existing task (for parts of a task, use create_subtasks). Set ownerAgentId to hand it to a specific agent.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Short title"),
        description: str("What to do"),
        acceptanceCriteria: str("How we know it's done"),
        ownerAgentId: str("Agent to assign, from list_agents (optional)"),
        priority: { type: "string", enum: [...PRIORITIES] },
        projectId: str("Project to put it in, from list_projects (optional)"),
      },
      required: ["title"],
    },
    args: z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(10_000).optional(),
      acceptanceCriteria: z.string().max(5_000).optional(),
      ownerAgentId: z.string().optional(),
      priority: z.enum(PRIORITIES).optional(),
      projectId: z.string().optional(),
    }),
    run: async (input, { agent }) => {
      const task = await createTask({
        ...input,
        ownerAgentId: input.ownerAgentId || null,
        projectId: input.projectId || null,
        column: "ready",
        createdBy: agent.id,
      });
      return { task: compactTask(task) };
    },
  }),

  tool({
    name: "write_note",
    description:
      "Save something the whole team should remember in the team notes: a decision, a convention, a fact you found, a result others will need. Writing to an existing title replaces that note, so read it first and keep what still holds.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Short, specific title, e.g. 'API naming convention'"),
        text: str("The note"),
        taskId: str("Related task id (optional)"),
      },
      required: ["title", "text"],
    },
    args: z.object({ title: z.string().trim().min(1).max(200), text: z.string().min(1).max(20_000), taskId: z.string().optional() }),
    run: async ({ title, text, taskId }, { agent }) => {
      const note = await writeNote({ title, text, authorAgentId: agent.id, taskId: taskId || null });
      return { note: { id: note.id, title: note.title, updatedAt: note.updatedAt } };
    },
  }),

  tool({
    name: "read_notes",
    description: "Read the team notes: decisions, conventions and results the team saved. Pass query to search titles and text.",
    inputSchema: { type: "object", properties: { query: str("Search text (optional)") } },
    args: z.object({ query: z.string().optional() }),
    run: async ({ query }) => {
      const notes = await getNotes({ query });
      return {
        notes: notes.slice(0, 50).map((n) => ({ title: n.title, text: n.text, author: n.authorAgentId ?? "user", updatedAt: n.updatedAt })),
      };
    },
  }),

  tool({
    name: "list_projects",
    description: "The projects on the board: goal, requirements, who may work on them, and how many open tasks and shared files each has.",
    inputSchema: { type: "object", properties: {} },
    args: z.object({}).passthrough(),
    run: async (_args, { agent }) => {
      const [projects, tasks] = await Promise.all([getProjects(), getTasks()]);
      return {
        projects: await Promise.all(
          projects.map(async (p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            goal: p.goal,
            context: p.context,
            members: p.memberAgentIds.length ? p.memberAgentIds : "everyone",
            youCanWork: isProjectMember(p, agent.id),
            openTasks: tasks.filter((t) => t.projectId === p.id && t.column !== "done").length,
            files: (await getArtifacts({ projectId: p.id, latestOnly: true, limit: 5_000 })).length,
          })),
        ),
      };
    },
  }),

  tool({
    name: "hand_off",
    description:
      "Pass a task you own to another agent, when its skills fit the rest better or you can't continue. Write a handoff note so they can pick it up cold: what's done, what's left, decisions made, which files matter, and test results. The task goes back to Ready for them. Save your files with save_artifact first.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: str("The task"),
        toAgentId: str("Who takes over, from list_agents"),
        note: str("The handoff note"),
      },
      required: ["taskId", "toAgentId", "note"],
    },
    args: z.object({ taskId: z.string(), toAgentId: z.string(), note: z.string().trim().min(20, "Write a real handoff note").max(10_000) }),
    run: async ({ taskId, toAgentId, note }, { agent }) => {
      const task = await handOffTask({ fromAgentId: agent.id, taskId, toAgentId, note });
      return { task: compactTask(task), handedTo: toAgentId };
    },
  }),

  tool({
    name: "read_saved_file",
    description:
      "Read a text file saved on a task or in a project's shared workspace (the latest version). Use get_task to see which files exist.",
    inputSchema: {
      type: "object",
      properties: {
        path: str("The file's path, e.g. src/app.ts"),
        taskId: str("A task whose files (or whose project's files) to look in"),
      },
      required: ["path", "taskId"],
    },
    args: z.object({ path: z.string().min(1), taskId: z.string() }),
    run: async ({ path, taskId }) => {
      const task = await getTask(taskId);
      if (!task) throw new ToolInputError(`No task ${taskId}`);
      const files = await getArtifacts(task.projectId ? { projectId: task.projectId, latestOnly: true, limit: 5_000 } : { taskId, latestOnly: true });
      const wanted = normalizeArtifactPath(path);
      const info = files.find((f) => f.path === wanted);
      if (!info) throw new ToolInputError(`No saved file ${wanted}. Saved: ${files.map((f) => f.path).slice(0, 50).join(", ") || "none"}`);
      const full = await getArtifact(info.id);
      if (!full) throw new ToolInputError(`No saved file ${wanted}`);
      if (!isText(full.mimeType)) return { ...fileInfo(info), content: null, note: "Not a text file" };
      const text = full.content.toString("utf8");
      return { ...fileInfo(info), content: text.slice(0, 50_000), ...(text.length > 50_000 ? { cut: true } : {}) };
    },
  }),

  tool({
    name: "remember",
    description:
      "Save something for yourself to remember in later tasks: how your user likes things done, a lesson from a mistake, a convention you follow. Only you see it. Things the whole team needs go in write_note instead. Writing to an existing title replaces it.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Short, specific title, e.g. 'User wants tests with every change'"),
        text: str("What to remember"),
        taskId: str("Related task id (optional)"),
      },
      required: ["title", "text"],
    },
    args: z.object({ title: z.string().trim().min(1).max(200), text: z.string().min(1).max(5_000), taskId: z.string().optional() }),
    run: async ({ title, text, taskId }, ctx) => {
      const m = await rememberForAgent({ agentId: ctx.agent.id, title, text, taskId: taskId || ctx.taskId || null });
      return { memory: { id: m.id, title: m.title, updatedAt: m.updatedAt } };
    },
  }),

  tool({
    name: "forget",
    description: "Delete one of your own memories that is wrong or no longer holds, by its title.",
    inputSchema: { type: "object", properties: { title: str("The memory's exact title") }, required: ["title"] },
    args: z.object({ title: z.string().trim().min(1) }),
    run: async ({ title }, { agent }) => {
      if (!(await forgetAgentMemory(agent.id, { title }))) {
        const titles = (await getAgentMemories(agent.id)).map((m) => m.title);
        throw new ToolInputError(`No memory titled "${title}". Yours: ${titles.join("; ") || "none"}`);
      }
      return { forgotten: title };
    },
  }),

  tool({
    name: "search_memory",
    description:
      "Search what the team remembers: team notes, your own memories, results of finished tasks, and your messages. Use it before starting work that may have been done or decided before. Returns the best matches with a short snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("What you're looking for, in a few words"),
        sources: {
          type: "array",
          items: { type: "string", enum: [...MEMORY_SOURCES] },
          description: "Limit the search to some sources (optional)",
        },
        limit: { type: "number", description: "How many results, up to 20 (default 8)" },
      },
      required: ["query"],
    },
    args: z.object({
      query: z.string().trim().min(1).max(500),
      sources: z.array(z.enum(MEMORY_SOURCES)).min(1).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    run: async ({ query, sources, limit }, { agent }) => {
      const hits = await searchMemory(agent.id, query, { sources, limit: limit ?? 8 });
      return { results: hits, ...(hits.length ? {} : { hint: "Nothing matched. Try other words, or fewer of them." }) };
    },
  }),

  tool({
    name: "report_progress",
    description: "Tell the board how far along you are. Send a short note on what you just did and what's next.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: str("Task id"),
        progressPct: { type: "number", description: "0 to 100" },
        note: str("One or two sentences"),
      },
      required: ["taskId"],
    },
    args: z.object({ taskId: z.string(), progressPct: z.number().min(0).max(100).optional(), note: z.string().max(5_000).optional() }),
    run: async ({ taskId, progressPct, note }, { agent }) => ({
      task: await reportProgress(agent.id, taskId, { progressPct, note }),
    }),
  }),

  tool({
    name: "complete_task",
    description: "Finish a task: give a summary of the result (and links, if any). The task moves to In review.",
    inputSchema: {
      type: "object",
      properties: { taskId: str("Task id"), summary: str("What you did and where the result is") },
      required: ["taskId", "summary"],
    },
    args: z.object({ taskId: z.string(), summary: z.string().min(1).max(20_000) }),
    run: async ({ taskId, summary }, { agent }) => {
      const task = await reportProgress(agent.id, taskId, { progressPct: 100, column: "review", note: summary });
      await heartbeat(agent.id, { status: "active", currentTaskId: null });
      // Delivery report: the task's files go up for review with it.
      const files = await getArtifacts({ taskId, latestOnly: true });
      for (const f of files) if (f.status === "draft") await setArtifactStatus(f.id, "in_review");
      const fileLines = files.map((f) => `- ${f.path} (v${f.version}): ${boardLink(`/api/ui/artifacts/${f.id}`)}`);
      if (task) {
        await notifyByEmail(
          `[AgentsHUB] ${agent.name} finished "${task.title}"`,
          [summary.slice(0, 4_000), fileLines.length && `Files:\n${fileLines.join("\n")}`, `It's waiting for your review.\n${boardLink("/")}`]
            .filter(Boolean)
            .join("\n\n"),
        );
      }
      return { task, files: files.map((f) => ({ path: f.path, version: f.version })) };
    },
  }),

  tool({
    name: "save_artifact",
    description:
      "Save a deliverable file (code, a document, a page, data) so the user can open and download it from the task. With a cloud computer, pass the file's path there; otherwise pass the file's text in content. Saving the same name again adds a new version. Save every file the user should get before complete_task.",
    inputSchema: {
      type: "object",
      properties: {
        path: str("File in your cloud computer, relative to the work folder (e.g. 'app/index.html')"),
        content: str("The file's text, when you have no cloud computer"),
        name: str("File name to save it as (defaults to path), e.g. 'report.md'"),
        note: str("One line on what this file is"),
        taskId: str("Task id (defaults to your current task)"),
      },
    },
    args: z.object({
      path: z.string().max(500).optional(),
      content: z.string().max(5_000_000).optional(),
      name: z.string().max(300).optional(),
      note: z.string().max(1_000).optional(),
      taskId: z.string().optional(),
    }),
    run: async ({ path, content, name, note, taskId }, ctx) => {
      const task = taskId || ctx.taskId;
      if (!task) throw new ToolInputError("Pass taskId");
      if (!(await getTask(task))) throw new ToolInputError(`No task ${task}`);
      let bytes: Buffer;
      if (path) {
        if (!ctx.sandbox) throw new ToolInputError("You have no cloud computer; pass the file's text in content");
        bytes = Buffer.from(await ctx.sandbox.readFile(path).catch((e) => Promise.reject(new ToolInputError(`Can't read ${path}: ${(e as Error).message}`))));
      } else if (content !== undefined) {
        bytes = Buffer.from(content, "utf8");
      } else {
        throw new ToolInputError("Pass path or content");
      }
      try {
        const { artifact, unchanged } = await saveArtifact({
          taskId: task,
          agentId: ctx.agent.id,
          runId: ctx.runId ?? null,
          sandboxId: ctx.sandbox?.id ?? null,
          path: name || path || "",
          content: bytes,
          note,
        });
        return {
          artifact: { id: artifact.id, path: artifact.path, version: artifact.version, sizeBytes: artifact.sizeBytes, kind: artifact.kind },
          unchanged: unchanged || undefined,
          link: boardLink(`/api/ui/artifacts/${artifact.id}`),
        };
      } catch (e) {
        if (e instanceof ArtifactError) throw new ToolInputError(e.message);
        throw e;
      }
    },
  }),

  tool({
    name: "send_message",
    description:
      "Write in the agents' chat. Set toAgentId for a direct message, or leave it empty to write to everyone. Set taskId when it's about a task. The user reads this chat.",
    inputSchema: {
      type: "object",
      properties: { text: str("Message"), toAgentId: str("Recipient agent id (optional)"), taskId: str("Related task id (optional)") },
      required: ["text"],
    },
    args: z.object({ text: z.string().min(1).max(10_000), toAgentId: z.string().optional(), taskId: z.string().optional() }),
    run: async ({ text, toAgentId, taskId }, { agent }) => ({
      message: await postMessage({ fromAgentId: agent.id, toAgentId: toAgentId || null, taskId: taskId || null, text }),
    }),
  }),

  tool({
    name: "check_inbox",
    description:
      "Read new messages for you and any commands from the user (pause, resume, redirect, stop). Call it between steps. Follow redirect instructions; on stop, finish up and stop working.",
    inputSchema: { type: "object", properties: { since: { type: "number", description: "Only messages after this time (ms)" } } },
    args: z.object({ since: z.number().optional() }),
    run: async ({ since }, { agent }) => {
      await heartbeat(agent.id, {});
      const [commands, messages] = await Promise.all([
        takePendingCommands(agent.id),
        getInbox(agent.id, since ?? Date.now() - 60 * 60_000),
      ]);
      return { commands, messages, now: Date.now() };
    },
  }),

  tool({
    name: "request_approval",
    description:
      "Ask the user before anything irreversible, anything involving money, or anything that publishes or sends something outside. Describe the exact action. Only do it if the decision is 'allow'.",
    inputSchema: {
      type: "object",
      properties: {
        action: str("The exact action, e.g. the command you will run"),
        reason: str("Why it's needed"),
        taskId: str("Related task id"),
      },
      required: ["action"],
    },
    args: z.object({ action: z.string().min(1).max(500), reason: z.string().max(2_000).optional(), taskId: z.string().optional() }),
    run: async ({ action, reason, taskId }, ctx) => {
      // Explicit requests always go to the user, even when the rules wouldn't flag them.
      const gate = await gateAction(ctx.agent.id, { action, taskId, reason, force: true });
      const result = ctx.waitForApproval ? await ctx.waitForApproval(gate) : gate;
      return {
        decision: result.decision,
        approvalId: "approval" in result && result.approval ? result.approval.id : null,
        hint:
          result.decision === "ask"
            ? "Waiting for the user. Call request_approval again with the same action to check; don't do it until the decision is 'allow'."
            : undefined,
      };
    },
  }),

  tool({
    name: "log_activity",
    description: "Add a line to the task's activity log (a tool you ran, a file you changed, an error you hit).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["tool_call", "file_edit", "note", "error"] },
        text: str("What happened"),
        taskId: str("Task id"),
      },
      required: ["type", "text"],
    },
    args: z.object({ type: z.enum(["tool_call", "file_edit", "note", "error"]), text: z.string().min(1).max(5_000), taskId: z.string().optional() }),
    run: async ({ type, text, taskId }, { agent }) => ({
      event: await addEvent({ agentId: agent.id, taskId: taskId || null, type, payload: { text } }),
    }),
  }),
];

export function findTool(name: string, tools: AgentTool[] = AGENT_TOOLS): AgentTool | undefined {
  return tools.find((t) => t.name === name);
}

async function unfinishedDependencies(ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const dep = await getTask(id);
    if (dep && dep.column !== "done" && dep.column !== "review") out.push(dep.title);
  }
  return out;
}
