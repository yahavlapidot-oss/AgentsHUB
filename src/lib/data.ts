/**
 * The one data-access module. UI pages, server actions and the agent API all go
 * through here, so the storage (or a future realtime server) can change without
 * touching components.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, getTableColumns, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { newId } from "./ids";
import { boardLink, notifyByEmail } from "./notify";
import { getBlobStore } from "./storage";
import { generateAgentToken, hashToken } from "./tokens";
import {
  agentMemories,
  agents,
  approvals,
  artifacts,
  commands,
  events,
  messages,
  notes,
  projects,
  runs,
  sandboxes,
  settings,
  tasks,
  type Agent,
  type AgentMemory,
  type Artifact,
  type ArtifactInfo,
  type ArtifactKind,
  type AgentEvent,
  type Approval,
  type Column,
  type Command,
  type EventType,
  type AgentRole,
  type Message,
  type Note,
  type Priority,
  type Project,
  type Provider,
  type PublicAgent,
  type Run,
  type Sandbox,
  type Task,
} from "./schema";

/** An agent with no heartbeat for this long is shown as offline. */
export const OFFLINE_AFTER_MS = 5 * 60_000;

function toPublic(a: Agent, now = Date.now()): PublicAgent {
  const { tokenHash: _hidden, ...rest } = a;
  const stale = !a.lastHeartbeat || now - a.lastHeartbeat > OFFLINE_AFTER_MS;
  return { ...rest, status: stale && a.status !== "paused" ? "offline" : a.status };
}

// ---------------------------------------------------------------- reads

export async function getAgents(): Promise<PublicAgent[]> {
  const rows = await db.select().from(agents).orderBy(agents.name);
  const now = Date.now();
  return rows.map((a) => toPublic(a, now));
}

export async function getAgent(id: string): Promise<PublicAgent | null> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return row ? toPublic(row) : null;
}

export async function getTasks(): Promise<Task[]> {
  return db.select().from(tasks).orderBy(desc(tasks.updatedAt));
}

export async function getTask(id: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  return row ?? null;
}

export async function getEvents(
  opts: { taskId?: string; agentId?: string; runId?: string; limit?: number } = {},
): Promise<AgentEvent[]> {
  const where = and(
    opts.taskId ? eq(events.taskId, opts.taskId) : undefined,
    opts.runId ? eq(events.runId, opts.runId) : undefined,
    opts.agentId ? eq(events.agentId, opts.agentId) : undefined,
  );
  return db
    .select()
    .from(events)
    .where(where)
    .orderBy(desc(events.at))
    .limit(opts.limit ?? 100);
}

export async function getMessages(
  opts: { taskId?: string; agentId?: string; limit?: number } = {},
): Promise<Message[]> {
  const where = and(
    opts.taskId ? eq(messages.taskId, opts.taskId) : undefined,
    opts.agentId
      ? or(eq(messages.fromAgentId, opts.agentId), eq(messages.toAgentId, opts.agentId))
      : undefined,
  );
  const rows = await db
    .select()
    .from(messages)
    .where(where)
    .orderBy(desc(messages.at))
    .limit(opts.limit ?? 200);
  return rows.reverse();
}

export async function getRuns(opts: { agentId?: string; limit?: number } = {}): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(opts.agentId ? eq(runs.agentId, opts.agentId) : undefined)
    .orderBy(desc(runs.startedAt))
    .limit(opts.limit ?? 200);
}

export async function getApprovals(opts: { pendingOnly?: boolean } = {}): Promise<Approval[]> {
  await expireApprovals();
  return db
    .select()
    .from(approvals)
    .where(opts.pendingOnly ? eq(approvals.decision, "pending") : undefined)
    .orderBy(desc(approvals.createdAt));
}

export async function getCommands(agentId: string): Promise<Command[]> {
  return db
    .select()
    .from(commands)
    .where(eq(commands.agentId, agentId))
    .orderBy(desc(commands.createdAt))
    .limit(50);
}

export type Snapshot = {
  agents: PublicAgent[];
  tasks: Task[];
  events: AgentEvent[];
  messages: Message[];
  approvals: Approval[];
  projects: Project[];
  /** Set while the emergency stop is on. */
  emergencyStop: { at: number; agentIds: string[] } | null;
  generatedAt: number;
};

/** Everything the live board needs in one round trip. */
export async function getSnapshot(): Promise<Snapshot> {
  const [a, t, e, m, ap, p, stop] = await Promise.all([
    getAgents(),
    getTasks(),
    getEvents({ limit: 60 }),
    getMessages({ limit: 100 }),
    getApprovals({ pendingOnly: true }),
    getProjects(),
    getEmergencyStop(),
  ]);
  return { agents: a, tasks: t, events: e, messages: m, approvals: ap, projects: p, emergencyStop: stop, generatedAt: Date.now() };
}

export type UsageRow = { key: string; runs: number; tokensIn: number; tokensOut: number; costUsd: number };

export async function getUsage(groupBy: "agent" | "model"): Promise<UsageRow[]> {
  const key = groupBy === "agent" ? runs.agentId : runs.model;
  return db
    .select({
      key: sql<string>`${key}`,
      runs: sql<number>`count(*)`,
      tokensIn: sql<number>`coalesce(sum(${runs.tokensIn}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${runs.tokensOut}), 0)`,
      costUsd: sql<number>`coalesce(sum(${runs.costUsd}), 0)`,
    })
    .from(runs)
    .groupBy(key)
    .orderBy(desc(sql`sum(${runs.tokensIn}) + sum(${runs.tokensOut})`));
}

// ---------------------------------------------------------------- agents

export async function createAgent(input: {
  name: string;
  provider: Provider;
  model: string;
  kind?: Agent["kind"];
  machine?: string | null;
  skills?: string[];
  instructions?: string;
  role?: AgentRole;
  sandboxEnabled?: boolean;
}): Promise<{ agent: PublicAgent; token: string }> {
  const token = generateAgentToken();
  const [row] = await db
    .insert(agents)
    .values({
      id: newId("agent"),
      name: input.name,
      provider: input.provider,
      model: input.model,
      kind: input.kind ?? "sdk",
      machine: input.machine ?? null,
      skills: input.skills ?? [],
      instructions: input.instructions ?? "",
      role: input.role ?? "member",
      sandboxEnabled: input.sandboxEnabled ?? false,
      tokenHash: hashToken(token),
      createdAt: Date.now(),
    })
    .returning();
  return { agent: toPublic(row), token };
}

/** Replaces an agent's token; the old one stops working immediately. */
export async function rotateAgentToken(agentId: string): Promise<string> {
  const token = generateAgentToken();
  await db.update(agents).set({ tokenHash: hashToken(token) }).where(eq(agents.id, agentId));
  return token;
}

export async function setAgentRole(agentId: string, role: AgentRole): Promise<void> {
  await db.update(agents).set({ role }).where(eq(agents.id, agentId));
}

export async function setAgentDisabledTools(agentId: string, names: string[]): Promise<void> {
  await db.update(agents).set({ disabledTools: names }).where(eq(agents.id, agentId));
}

export async function setAgentAutonomy(agentId: string, autonomy: Agent["autonomy"]): Promise<void> {
  await db.update(agents).set({ autonomy }).where(eq(agents.id, agentId));
}

export async function setAgentSandbox(agentId: string, enabled: boolean): Promise<void> {
  await db.update(agents).set({ sandboxEnabled: enabled }).where(eq(agents.id, agentId));
}

export async function deleteAgent(agentId: string): Promise<void> {
  await db.update(tasks).set({ ownerAgentId: null }).where(eq(tasks.ownerAgentId, agentId));
  await db.delete(agentMemories).where(eq(agentMemories.agentId, agentId));
  await db.delete(agents).where(eq(agents.id, agentId));
}

export async function findAgentByToken(token: string): Promise<Agent | null> {
  const [row] = await db.select().from(agents).where(eq(agents.tokenHash, hashToken(token)));
  return row ?? null;
}

export async function heartbeat(
  agentId: string,
  input: { status?: "active" | "waiting"; currentTaskId?: string | null; model?: string } = {},
): Promise<void> {
  const [current] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!current) return;
  await db
    .update(agents)
    .set({
      lastHeartbeat: Date.now(),
      // A paused agent stays paused until the user resumes it.
      status: current.status === "paused" ? "paused" : (input.status ?? "active"),
      ...(input.currentTaskId !== undefined ? { currentTaskId: input.currentTaskId } : {}),
      ...(input.model ? { model: input.model } : {}),
    })
    .where(eq(agents.id, agentId));
}

// ---------------------------------------------------------------- tasks

export async function createTask(input: {
  title: string;
  description?: string;
  column?: Column;
  priority?: Priority;
  ownerAgentId?: string | null;
  parentTaskId?: string | null;
  dependsOn?: string[];
  acceptanceCriteria?: string;
  budgetUsd?: number | null;
  createdBy?: string;
  projectId?: string | null;
}): Promise<Task> {
  const now = Date.now();
  // Subtasks stay in their parent's project.
  let projectId = input.projectId;
  if (projectId === undefined && input.parentTaskId) projectId = (await getTask(input.parentTaskId))?.projectId ?? null;
  if (projectId && !(await getProject(projectId))) throw new ConflictError(`No project ${projectId}`);
  const [row] = await db
    .insert(tasks)
    .values({
      id: newId("task"),
      title: input.title,
      description: input.description ?? "",
      column: input.column ?? (input.ownerAgentId ? "ready" : "backlog"),
      priority: input.priority ?? "medium",
      ownerAgentId: input.ownerAgentId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      projectId: projectId ?? null,
      dependsOn: input.dependsOn ?? [],
      acceptanceCriteria: input.acceptanceCriteria ?? "",
      budgetUsd: input.budgetUsd ?? null,
      createdBy: input.createdBy ?? "user",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export type TaskPatch = Partial<
  Pick<
    Task,
    "title" | "description" | "column" | "priority" | "ownerAgentId" | "acceptanceCriteria" | "progressPct" | "budgetUsd" | "projectId"
  >
>;

/** Updates a task and records column and owner changes on its timeline. */
export async function updateTask(
  taskId: string,
  patch: TaskPatch,
  actor: { agentId: string | null } = { agentId: null },
): Promise<Task | null> {
  const before = await getTask(taskId);
  if (!before) return null;
  const next: TaskPatch = { ...patch };
  if (next.progressPct !== undefined) next.progressPct = clampPct(next.progressPct);
  if (next.column === "done") next.progressPct = 100;

  const [row] = await db
    .update(tasks)
    .set({ ...next, updatedAt: Date.now() })
    .where(eq(tasks.id, taskId))
    .returning();

  if (patch.column && patch.column !== before.column) {
    await addEvent({
      agentId: actor.agentId,
      taskId,
      type: "status_change",
      payload: { from: before.column, to: patch.column },
    });
  }
  if (patch.projectId !== undefined && patch.projectId !== before.projectId) {
    // The task's files move with it into the other project's workspace.
    await db.update(artifacts).set({ projectId: patch.projectId }).where(eq(artifacts.taskId, taskId));
  }
  if (patch.ownerAgentId !== undefined && patch.ownerAgentId !== before.ownerAgentId) {
    await addEvent({
      agentId: actor.agentId,
      taskId,
      type: "note",
      payload: { text: "Owner changed", from: before.ownerAgentId, to: patch.ownerAgentId },
    });
  }
  return row;
}

/** An agent takes a task: it becomes the owner and the task moves to In progress. */
export async function claimTask(agentId: string, taskId: string): Promise<Task | null> {
  const task = await getTask(taskId);
  if (!task) return null;
  if (task.ownerAgentId && task.ownerAgentId !== agentId) {
    throw new ConflictError("Task is already owned by another agent");
  }
  await assertProjectMember(task.projectId, agentId);
  const updated = await updateTask(taskId, { ownerAgentId: agentId, column: "in_progress" }, { agentId });
  await heartbeat(agentId, { status: "active", currentTaskId: taskId });
  return updated;
}

export async function reportProgress(
  agentId: string,
  taskId: string,
  input: { progressPct?: number; note?: string; column?: Column },
): Promise<Task | null> {
  const updated = await updateTask(
    taskId,
    {
      ...(input.progressPct !== undefined ? { progressPct: input.progressPct } : {}),
      ...(input.column ? { column: input.column } : {}),
    },
    { agentId },
  );
  if (updated && input.note) {
    await addEvent({ agentId, taskId, type: "note", payload: { text: input.note, progressPct: updated.progressPct } });
  }
  await heartbeat(agentId, { status: "active", currentTaskId: taskId });
  return updated;
}

// ---------------------------------------------------------------- events & chat

export async function addEvent(input: {
  agentId: string | null;
  taskId?: string | null;
  runId?: string | null;
  type: EventType;
  payload?: Record<string, unknown>;
}): Promise<AgentEvent> {
  const [row] = await db
    .insert(events)
    .values({
      id: newId("evt"),
      agentId: input.agentId,
      taskId: input.taskId ?? null,
      runId: input.runId ?? null,
      type: input.type,
      payload: input.payload ?? {},
      at: Date.now(),
    })
    .returning();
  return row;
}

export async function postMessage(input: {
  fromAgentId: string | null;
  toAgentId?: string | null;
  taskId?: string | null;
  text: string;
}): Promise<Message> {
  const [row] = await db
    .insert(messages)
    .values({
      id: newId("msg"),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId ?? null,
      taskId: input.taskId ?? null,
      text: input.text,
      at: Date.now(),
    })
    .returning();
  return row;
}

/** Messages addressed to this agent (or to everyone) since a point in time. */
export async function getInbox(agentId: string, since: number): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(
      and(
        sql`${messages.at} > ${since}`,
        or(eq(messages.toAgentId, agentId), isNull(messages.toAgentId)),
        or(isNull(messages.fromAgentId), sql`${messages.fromAgentId} != ${agentId}`),
      ),
    )
    .orderBy(messages.at)
    .limit(100);
}

/**
 * Messages that should wake an idle hosted agent: direct messages to it, and
 * anything the user wrote to everyone. Agents writing to everyone don't wake
 * the whole team.
 */
export async function getWakeMessages(agentId: string, since: number): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(
      and(
        sql`${messages.at} > ${since}`,
        or(eq(messages.toAgentId, agentId), and(isNull(messages.toAgentId), isNull(messages.fromAgentId))),
        or(isNull(messages.fromAgentId), sql`${messages.fromAgentId} != ${agentId}`),
      ),
    )
    .orderBy(messages.at)
    .limit(100);
}

/** Records that a hosted agent has seen its messages up to this time. */
export async function markInboxRead(agentId: string, at: number): Promise<void> {
  await db.update(agents).set({ inboxReadAt: at }).where(eq(agents.id, agentId));
}

// ---------------------------------------------------------------- team notes

export async function getNotes(opts: { query?: string } = {}): Promise<Note[]> {
  const rows = await db.select().from(notes).orderBy(desc(notes.updatedAt));
  const q = opts.query?.trim().toLowerCase();
  return q ? rows.filter((n) => n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q)) : rows;
}

/** Creates the note, or replaces the text of the note with the same title. */
export async function writeNote(input: {
  title: string;
  text: string;
  authorAgentId: string | null;
  taskId?: string | null;
}): Promise<Note> {
  const now = Date.now();
  const [row] = await db
    .insert(notes)
    .values({
      id: newId("note"),
      title: input.title,
      text: input.text,
      authorAgentId: input.authorAgentId,
      taskId: input.taskId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notes.title,
      set: { text: input.text, authorAgentId: input.authorAgentId, taskId: input.taskId ?? null, updatedAt: now },
    })
    .returning();
  return row;
}

export async function deleteNote(id: string): Promise<void> {
  await db.delete(notes).where(eq(notes.id, id));
}

// ---------------------------------------------------------------- an agent's own memory

export const MAX_AGENT_MEMORIES = Number(process.env.AGENT_MAX_MEMORIES ?? 200);

export async function getAgentMemories(agentId: string): Promise<AgentMemory[]> {
  return db.select().from(agentMemories).where(eq(agentMemories.agentId, agentId)).orderBy(desc(agentMemories.updatedAt));
}

/** Creates the memory, or replaces the text of the agent's memory with the same title. */
export async function rememberForAgent(input: { agentId: string; title: string; text: string; taskId?: string | null }): Promise<AgentMemory> {
  const now = Date.now();
  const existing = await getAgentMemories(input.agentId);
  if (existing.length >= MAX_AGENT_MEMORIES && !existing.some((m) => m.title === input.title)) {
    throw new ConflictError(`You already have ${MAX_AGENT_MEMORIES} memories. Forget or merge old ones first.`);
  }
  const [row] = await db
    .insert(agentMemories)
    .values({ id: newId("mem"), agentId: input.agentId, title: input.title, text: input.text, taskId: input.taskId ?? null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [agentMemories.agentId, agentMemories.title],
      set: { text: input.text, taskId: input.taskId ?? null, updatedAt: now },
    })
    .returning();
  return row;
}

/** Removes one memory, by title (the agent) or by id (the user). Only ever the agent's own. */
export async function forgetAgentMemory(agentId: string, by: { title?: string; id?: string }): Promise<boolean> {
  const match = by.id ? eq(agentMemories.id, by.id) : by.title ? eq(agentMemories.title, by.title) : undefined;
  if (!match) return false;
  const rows = await db.delete(agentMemories).where(and(eq(agentMemories.agentId, agentId), match)).returning({ id: agentMemories.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------- runs & usage

export async function startRun(agentId: string, input: { taskId?: string | null; model: string }): Promise<Run> {
  const [row] = await db
    .insert(runs)
    .values({ id: newId("run"), agentId, taskId: input.taskId ?? null, model: input.model, startedAt: Date.now() })
    .returning();
  return row;
}

/** Adds token usage to a run and to the agent's running totals. */
export async function addUsage(
  agentId: string,
  runId: string,
  usage: { tokensIn: number; tokensOut: number; costUsd?: number },
): Promise<void> {
  const cost = usage.costUsd ?? 0;
  await db
    .update(runs)
    .set({
      tokensIn: sql`${runs.tokensIn} + ${usage.tokensIn}`,
      tokensOut: sql`${runs.tokensOut} + ${usage.tokensOut}`,
      costUsd: sql`${runs.costUsd} + ${cost}`,
    })
    .where(and(eq(runs.id, runId), eq(runs.agentId, agentId)));
  await db
    .update(agents)
    .set({
      tokensIn: sql`${agents.tokensIn} + ${usage.tokensIn}`,
      tokensOut: sql`${agents.tokensOut} + ${usage.tokensOut}`,
      costUsd: sql`${agents.costUsd} + ${cost}`,
    })
    .where(eq(agents.id, agentId));
}

export async function endRun(agentId: string, runId: string, outcome: NonNullable<Run["outcome"]>): Promise<void> {
  await db
    .update(runs)
    .set({ endedAt: Date.now(), outcome })
    .where(and(eq(runs.id, runId), eq(runs.agentId, agentId)));
}

/** One-shot usage report: records a finished run in a single call. */
export async function recordUsage(
  agentId: string,
  input: { model: string; taskId?: string | null; tokensIn: number; tokensOut: number; costUsd?: number },
): Promise<Run> {
  const run = await startRun(agentId, { taskId: input.taskId, model: input.model });
  await addUsage(agentId, run.id, input);
  await endRun(agentId, run.id, "success");
  return run;
}

/** Everything spent on a task so far: model tokens and sandbox time, over all runs. */
export async function getTaskCost(taskId: string): Promise<number> {
  const [row] = await db
    .select({ cost: sql<number>`coalesce(sum(${runs.costUsd}), 0)` })
    .from(runs)
    .where(eq(runs.taskId, taskId));
  return row?.cost ?? 0;
}

export async function getRun(runId: string): Promise<Run | null> {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId));
  return row ?? null;
}

// ---------------------------------------------------------------- control: commands & approvals

export async function sendCommand(
  agentId: string,
  type: Command["type"],
  text = "",
): Promise<Command> {
  const [row] = await db
    .insert(commands)
    .values({ id: newId("cmd"), agentId, type, text, createdAt: Date.now() })
    .returning();
  if (type === "pause" || type === "stop") {
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, agentId));
  } else if (type === "resume") {
    await db.update(agents).set({ status: "active" }).where(eq(agents.id, agentId));
  }
  return row;
}

/** Returns the agent's pending commands and marks them delivered. */
export async function takePendingCommands(agentId: string): Promise<Command[]> {
  const pending = await db
    .select()
    .from(commands)
    .where(and(eq(commands.agentId, agentId), eq(commands.status, "pending")))
    .orderBy(commands.createdAt);
  if (pending.length) {
    await db
      .update(commands)
      .set({ status: "delivered" })
      .where(inArray(commands.id, pending.map((c) => c.id)));
  }
  return pending;
}

export async function completeCommand(agentId: string, commandId: string): Promise<void> {
  await db
    .update(commands)
    .set({ status: "done" })
    .where(and(eq(commands.id, commandId), eq(commands.agentId, agentId)));
}

/** An agent asks the user before a risky step. Its task moves to "Waiting on you". */
export async function requestApproval(
  agentId: string,
  input: { taskId?: string | null; action: string; reason?: string; risk?: Approval["risk"]; service?: string; details?: string },
): Promise<Approval> {
  const [row] = await db
    .insert(approvals)
    .values({
      id: newId("apr"),
      agentId,
      taskId: input.taskId ?? null,
      action: input.action,
      reason: input.reason ?? "",
      service: input.service ?? "",
      details: (input.details ?? "").slice(0, 20_000),
      risk: input.risk ?? "medium",
      createdAt: Date.now(),
    })
    .returning();
  if (input.taskId) await updateTask(input.taskId, { column: "waiting_on_you" }, { agentId });
  await db.update(agents).set({ status: "waiting" }).where(eq(agents.id, agentId));
  const [agent] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId));
  await notifyByEmail(
    `[AgentsHUB] ${agent?.name ?? "An agent"} needs your approval: ${row.action}`,
    [
      `${agent?.name ?? "An agent"} is waiting for you before: ${row.action}`,
      `Risk: ${row.risk}`,
      row.service ? `Where: ${row.service}` : "",
      row.reason ? `Why: ${row.reason}` : "",
      row.details ? `What goes out:\n${row.details.slice(0, 2_000)}` : "",
      "",
      `Approve or deny: ${boardLink("/approvals")}`,
    ]
      .filter((l, i, all) => l || i === all.length - 2)
      .join("\n"),
  );
  return row;
}

/** The newest approval for this exact action that hasn't been used up yet. */
export async function findOpenApproval(agentId: string, action: string): Promise<Approval | null> {
  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.agentId, agentId), eq(approvals.action, action), isNull(approvals.consumedAt)))
    .orderBy(desc(approvals.createdAt))
    .limit(1);
  return row ?? null;
}

/** Marks a decided approval as used, so the same action has to be approved again next time. */
export async function consumeApproval(id: string): Promise<void> {
  await db.update(approvals).set({ consumedAt: Date.now() }).where(eq(approvals.id, id));
}

/** A request nobody decides on within this many hours expires; the agent takes it as a no. */
export const APPROVAL_PENDING_HOURS = Number(process.env.APPROVAL_PENDING_HOURS ?? 24);
/** An approval must be used within this many minutes of your OK, or the agent has to ask again. */
export const APPROVAL_VALID_MINUTES = Number(process.env.APPROVAL_VALID_MINUTES ?? 60);

/** Marks requests that waited too long as expired, and puts their tasks back in front of you. */
export async function expireApprovals(now = Date.now()): Promise<Approval[]> {
  const rows = await db
    .update(approvals)
    .set({ decision: "expired", decidedAt: now })
    .where(and(eq(approvals.decision, "pending"), sql`${approvals.createdAt} < ${now - APPROVAL_PENDING_HOURS * 60 * 60_000}`))
    .returning();
  for (const r of rows) {
    await addEvent({ agentId: r.agentId, taskId: r.taskId, type: "note", payload: { text: `Approval expired without a decision: "${r.action}"`, approvalId: r.id } });
  }
  return rows;
}

/** An approved request that sat unused past its window; it no longer counts. */
export function approvalTooOld(a: Approval, now = Date.now()): boolean {
  return a.decision === "approved" && a.decidedAt != null && now - a.decidedAt > APPROVAL_VALID_MINUTES * 60_000;
}

export async function expireApproval(id: string): Promise<void> {
  await db.update(approvals).set({ decision: "expired", consumedAt: Date.now() }).where(eq(approvals.id, id));
}

// ---------------------------------------------------------------- emergency stop

type StopState = { at: number; agentIds: string[] };

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as T | undefined) ?? null;
}

export async function setSetting(key: string, value: unknown | null): Promise<void> {
  if (value === null) {
    await db.delete(settings).where(eq(settings.key, key));
    return;
  }
  await db
    .insert(settings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } });
}

export async function getEmergencyStop(): Promise<StopState | null> {
  return getSetting<StopState>("emergency_stop");
}

/**
 * Stops every agent at once: each gets a stop command (hosted runs end at their
 * next step, outside agents see it in their inbox and hook), nothing new starts,
 * and every action is refused until you resume. Closing the cloud computers is
 * done by the caller (see src/lib/sandbox/session.ts).
 */
export async function emergencyStop(): Promise<StopState> {
  const existing = await getEmergencyStop();
  if (existing) return existing;
  const running = (await db.select({ id: agents.id, status: agents.status }).from(agents)).filter((a) => a.status !== "paused");
  for (const a of running) await sendCommand(a.id, "stop", "Emergency stop by the user");
  const state = { at: Date.now(), agentIds: running.map((a) => a.id) };
  await setSetting("emergency_stop", state);
  await addEvent({ agentId: null, type: "status_change", payload: { text: `turned on the emergency stop (${running.length} agent${running.length === 1 ? "" : "s"} stopped)` } });
  return state;
}

/** Lifts the stop and resumes the agents it stopped. Agents you had paused yourself stay paused. */
export async function resumeAfterEmergencyStop(): Promise<number> {
  const state = await getEmergencyStop();
  if (!state) return 0;
  if (state.agentIds.length) {
    // A stop nobody picked up would otherwise end the agent's next task right away.
    await db
      .update(commands)
      .set({ status: "done" })
      .where(and(inArray(commands.agentId, state.agentIds), eq(commands.type, "stop"), eq(commands.status, "pending")));
  }
  for (const id of state.agentIds) await sendCommand(id, "resume", "Resumed after the emergency stop");
  await setSetting("emergency_stop", null);
  await addEvent({ agentId: null, type: "status_change", payload: { text: "turned off the emergency stop" } });
  return state.agentIds.length;
}

// ---------------------------------------------------------------- audit log

export type AuditEntry = {
  at: number;
  /** Who did it: an agent's name, or "You". */
  actor: string;
  /** The agent it concerns, for filtering. */
  agentId: string | null;
  taskId: string | null;
  kind: "tool" | "file" | "status" | "error" | "note" | "approval" | "command";
  text: string;
  detail?: string;
};

/** Everything that happened, newest first: tool calls, files, approvals asked, decided and used, and your commands. */
export async function getAuditLog(opts: { agentId?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  const limit = opts.limit ?? 300;
  const [evts, aprs, cmds, everyone] = await Promise.all([
    getEvents({ agentId: opts.agentId, limit }),
    db
      .select()
      .from(approvals)
      .where(opts.agentId ? eq(approvals.agentId, opts.agentId) : undefined)
      .orderBy(desc(approvals.createdAt))
      .limit(limit),
    db
      .select()
      .from(commands)
      .where(opts.agentId ? eq(commands.agentId, opts.agentId) : undefined)
      .orderBy(desc(commands.createdAt))
      .limit(limit),
    db.select({ id: agents.id, name: agents.name }).from(agents),
  ]);
  const name = (id: string | null) => (id ? everyone.find((a) => a.id === id)?.name ?? "A removed agent" : "You");
  const kindOf: Record<AgentEvent["type"], AuditEntry["kind"]> = { tool_call: "tool", file_edit: "file", status_change: "status", error: "error", note: "note" };
  const out: AuditEntry[] = [];
  for (const e of evts) {
    const p = e.payload as { text?: unknown; tool?: unknown; input?: unknown; error?: unknown; approvalId?: unknown };
    // Approval notes repeat what the approval rows below already say.
    if (p.approvalId) continue;
    const text = typeof p.text === "string" ? p.text : typeof p.tool === "string" ? `called ${p.tool}${p.error ? " (failed)" : ""}` : e.type;
    const detail = p.input !== undefined ? JSON.stringify(p.input).slice(0, 1_000) : typeof p.error === "string" ? p.error : undefined;
    out.push({ at: e.at, actor: name(e.agentId), agentId: e.agentId, taskId: e.taskId, kind: kindOf[e.type], text, detail });
  }
  for (const a of aprs) {
    const where = a.service ? ` (${a.service})` : "";
    const base = { agentId: a.agentId, taskId: a.taskId, kind: "approval" as const };
    out.push({ ...base, at: a.createdAt, actor: name(a.agentId), text: `asked to: ${a.action}${where}`, detail: a.details || a.reason || undefined });
    if (a.decidedAt && a.decision === "expired") {
      out.push({ ...base, at: a.decidedAt, actor: name(a.agentId), text: `request expired without a decision: ${a.action}` });
    } else if (a.decidedAt) {
      out.push({ ...base, at: a.decidedAt, actor: "You", text: `${a.decision} ${name(a.agentId)}'s request: ${a.action}` });
    }
    if (a.consumedAt && a.decision === "approved") out.push({ ...base, at: a.consumedAt, actor: name(a.agentId), text: `used the approval: ${a.action}` });
  }
  for (const c of cmds) {
    out.push({ at: c.createdAt, actor: "You", agentId: c.agentId, taskId: null, kind: "command", text: `sent ${c.type} to ${name(c.agentId)}${c.text ? `: ${c.text}` : ""}` });
  }
  return out.sort((x, y) => y.at - x.at).slice(0, limit);
}

/** Hosted agents (run by AgentsHUB) with the raw row, for the runner. */
export async function getHostedAgents(): Promise<Agent[]> {
  return db.select().from(agents).where(eq(agents.kind, "hosted")).orderBy(agents.name);
}

export async function getApproval(id: string): Promise<Approval | null> {
  const [row] = await db.select().from(approvals).where(eq(approvals.id, id));
  return row ?? null;
}

export async function decideApproval(id: string, decision: "approved" | "denied"): Promise<Approval | null> {
  const [row] = await db
    .update(approvals)
    .set({ decision, decidedAt: Date.now() })
    .where(and(eq(approvals.id, id), eq(approvals.decision, "pending")))
    .returning();
  if (!row) return null;
  if (row.taskId) {
    const task = await getTask(row.taskId);
    if (task?.column === "waiting_on_you") await updateTask(row.taskId, { column: "in_progress" });
  }
  await addEvent({
    agentId: null,
    taskId: row.taskId,
    type: "note",
    payload: { text: `You ${decision} "${row.action}"`, approvalId: row.id },
  });
  const stillWaiting = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.agentId, row.agentId), eq(approvals.decision, "pending")));
  if (!stillWaiting.length) {
    await db
      .update(agents)
      .set({ status: "active" })
      .where(and(eq(agents.id, row.agentId), eq(agents.status, "waiting")));
  }
  return row;
}

// ---------------------------------------------------------------- sandboxes

export async function createSandboxRecord(input: {
  agentId: string;
  taskId: string | null;
  runId: string | null;
  provider: string;
}): Promise<Sandbox> {
  const [row] = await db
    .insert(sandboxes)
    .values({ id: newId("sbx"), ...input, status: "starting", startedAt: Date.now() })
    .returning();
  return row;
}

export async function updateSandboxRecord(
  id: string,
  patch: Partial<Pick<Sandbox, "externalId" | "status" | "costUsd" | "error" | "endedAt">> & { addCommands?: number },
): Promise<void> {
  const { addCommands, ...rest } = patch;
  await db
    .update(sandboxes)
    .set({ ...rest, ...(addCommands ? { commands: sql`${sandboxes.commands} + ${addCommands}` } : {}) })
    .where(eq(sandboxes.id, id));
}

/** Sandboxes that are starting or running, newest first. */
export async function getOpenSandboxes(): Promise<Sandbox[]> {
  return db
    .select()
    .from(sandboxes)
    .where(inArray(sandboxes.status, ["starting", "running"]))
    .orderBy(desc(sandboxes.startedAt));
}

export async function getSandboxes(opts: { taskId?: string; limit?: number } = {}): Promise<Sandbox[]> {
  return db
    .select()
    .from(sandboxes)
    .where(opts.taskId ? eq(sandboxes.taskId, opts.taskId) : undefined)
    .orderBy(desc(sandboxes.startedAt))
    .limit(opts.limit ?? 50);
}

// ---------------------------------------------------------------- projects

export async function getProjects(): Promise<Project[]> {
  return db.select().from(projects).orderBy(desc(projects.updatedAt));
}

export async function getProject(id: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row ?? null;
}

export type ProjectInput = {
  name: string;
  goal?: string;
  context?: string;
  memberAgentIds?: string[];
  status?: Project["status"];
  budgetUsd?: number | null;
};

export async function createProject(input: ProjectInput): Promise<Project> {
  const now = Date.now();
  const [row] = await db
    .insert(projects)
    .values({
      id: newId("proj"),
      name: input.name,
      goal: input.goal ?? "",
      context: input.context ?? "",
      memberAgentIds: [...new Set(input.memberAgentIds ?? [])],
      status: input.status ?? "active",
      budgetUsd: input.budgetUsd ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

export async function updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project | null> {
  const set = { ...patch, ...(patch.memberAgentIds ? { memberAgentIds: [...new Set(patch.memberAgentIds)] } : {}), updatedAt: Date.now() };
  const [row] = await db.update(projects).set(set).where(eq(projects.id, id)).returning();
  return row ?? null;
}

/** The tasks and files stay; they just no longer belong to a project. */
export async function deleteProject(id: string): Promise<void> {
  await db.update(tasks).set({ projectId: null }).where(eq(tasks.projectId, id));
  await db.update(artifacts).set({ projectId: null }).where(eq(artifacts.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
}

/** A project without members is open to every agent. */
export function isProjectMember(project: Pick<Project, "memberAgentIds"> | null, agentId: string): boolean {
  return !project || !project.memberAgentIds.length || project.memberAgentIds.includes(agentId);
}

async function assertProjectMember(projectId: string | null, agentId: string | null): Promise<void> {
  if (!projectId || !agentId) return;
  const project = await getProject(projectId);
  if (!isProjectMember(project, agentId)) {
    throw new ConflictError(`Only members of the project "${project!.name}" can work on its tasks and files`);
  }
}

/**
 * The owner passes a task to another agent with a handoff note: what's done,
 * what's next, test results. The task goes back to Ready for the new owner, and
 * the note leads its brief.
 */
export async function handOffTask(input: { fromAgentId: string; taskId: string; toAgentId: string; note: string }): Promise<Task> {
  const task = await getTask(input.taskId);
  if (!task) throw new ConflictError(`No task ${input.taskId}`);
  if (task.ownerAgentId !== input.fromAgentId) throw new ConflictError("Only the task's owner can hand it off");
  if (input.toAgentId === input.fromAgentId) throw new ConflictError("Hand it to another agent");
  const to = await getAgent(input.toAgentId);
  if (!to) throw new ConflictError(`No agent ${input.toAgentId}`);
  await assertProjectMember(task.projectId, to.id);
  await addEvent({
    agentId: input.fromAgentId,
    taskId: task.id,
    type: "status_change",
    payload: { text: `Handed off to ${to.name}`, handoff: { to: to.id, note: input.note } },
  });
  await postMessage({ fromAgentId: input.fromAgentId, toAgentId: to.id, taskId: task.id, text: `I handed "${task.title}" (${task.id}) to you.\n\n${input.note}` });
  const updated = await updateTask(task.id, { ownerAgentId: to.id, column: "ready" }, { agentId: input.fromAgentId });
  return updated!;
}

/** The newest handoff note on a task, if any. */
export async function getLastHandoff(taskId: string): Promise<{ fromAgentId: string | null; note: string; at: number } | null> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.taskId, taskId), eq(events.type, "status_change")))
    .orderBy(desc(events.at))
    .limit(50);
  for (const e of rows) {
    const h = (e.payload as { handoff?: { note?: unknown } }).handoff;
    if (h && typeof h.note === "string") return { fromAgentId: e.agentId, note: h.note, at: e.at };
  }
  return null;
}

// ---------------------------------------------------------------- artifacts

/** Largest single file an agent can save, and the most one task can hold across all versions. */
export const MAX_ARTIFACT_BYTES = Number(process.env.ARTIFACT_MAX_BYTES ?? 5 * 1024 * 1024);
export const MAX_TASK_ARTIFACT_BYTES = Number(process.env.ARTIFACT_MAX_TASK_BYTES ?? 50 * 1024 * 1024);

const { content: _content, ...artifactInfoColumns } = getTableColumns(artifacts);

/**
 * Saves a file as the next version of `path` on the task. Saving the exact same
 * bytes again returns the existing version instead of adding a copy.
 */
export async function saveArtifact(input: {
  taskId: string | null;
  agentId: string | null;
  runId?: string | null;
  sandboxId?: string | null;
  path: string;
  content: Buffer;
  note?: string;
}): Promise<{ artifact: ArtifactInfo; unchanged: boolean }> {
  if (input.content.length > MAX_ARTIFACT_BYTES) {
    throw new ArtifactError(`File is ${input.content.length} bytes; the limit is ${MAX_ARTIFACT_BYTES}`);
  }
  const path = normalizeArtifactPath(input.path);
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const projectId = input.taskId ? ((await getTask(input.taskId))?.projectId ?? null) : null;
  await assertProjectMember(projectId, input.agentId);
  // In a project, versions run across all its tasks: the workspace has one history per path.
  const scope = projectId ? eq(artifacts.projectId, projectId) : input.taskId ? eq(artifacts.taskId, input.taskId) : isNull(artifacts.taskId);
  const [latest] = await db
    .select(artifactInfoColumns)
    .from(artifacts)
    .where(and(scope, eq(artifacts.path, path)))
    .orderBy(desc(artifacts.version))
    .limit(1);
  if (latest && latest.sha256 === sha256) return { artifact: latest, unchanged: true };

  if (input.taskId) {
    const [used] = await db
      .select({ bytes: sql<number>`coalesce(sum(${artifacts.sizeBytes}), 0)` })
      .from(artifacts)
      .where(eq(artifacts.taskId, input.taskId));
    if ((used?.bytes ?? 0) + input.content.length > MAX_TASK_ARTIFACT_BYTES) {
      throw new ArtifactError(`This task's files would pass ${MAX_TASK_ARTIFACT_BYTES} bytes`);
    }
  }

  const { kind, mimeType } = classifyArtifact(path, input.content);
  const id = newId("art");
  // With a bucket configured the bytes go there first; the row only points at them.
  const store = getBlobStore();
  let storageKey = store ? `artifacts/${input.taskId ?? "no-task"}/${id}` : null;
  if (store && storageKey) {
    try {
      await store.put(storageKey, input.content, mimeType);
    } catch (e) {
      // A bucket problem shouldn't lose the agent's work: keep this file in the database.
      console.error("[storage] upload failed, keeping the file in the database", e);
      storageKey = null;
    }
  }
  const [row] = await db
    .insert(artifacts)
    .values({
      id,
      taskId: input.taskId,
      projectId,
      agentId: input.agentId,
      runId: input.runId ?? null,
      sandboxId: input.sandboxId ?? null,
      path,
      version: (latest?.version ?? 0) + 1,
      kind,
      mimeType,
      sizeBytes: input.content.length,
      sha256,
      note: input.note ?? "",
      content: storageKey ? Buffer.alloc(0) : input.content,
      storageKey,
      createdAt: Date.now(),
    })
    .returning(artifactInfoColumns);
  await addEvent({
    agentId: input.agentId,
    taskId: input.taskId,
    runId: input.runId ?? null,
    type: "file_edit",
    payload: { text: `Saved ${path} (v${row.version}, ${row.sizeBytes} bytes)`, artifactId: row.id },
  });
  return { artifact: row, unchanged: false };
}

/**
 * Every version, newest first. `latestOnly` keeps one row per path: per project
 * for project files (the workspace), per task otherwise.
 */
export async function getArtifacts(
  opts: { taskId?: string; projectId?: string; latestOnly?: boolean; limit?: number } = {},
): Promise<ArtifactInfo[]> {
  const rows = await db
    .select(artifactInfoColumns)
    .from(artifacts)
    .where(and(opts.taskId ? eq(artifacts.taskId, opts.taskId) : undefined, opts.projectId ? eq(artifacts.projectId, opts.projectId) : undefined))
    .orderBy(desc(artifacts.createdAt), desc(artifacts.version))
    .limit(opts.limit ?? 500);
  if (!opts.latestOnly) return rows;
  const seen = new Set<string>();
  return rows.filter((a) => {
    const key = `${a.projectId ? `p:${a.projectId}` : `t:${a.taskId}`}\u0000${a.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One file with its bytes, read from the bucket when it was saved there. */
export async function getArtifact(id: string): Promise<Artifact | null> {
  const [row] = await db.select().from(artifacts).where(eq(artifacts.id, id));
  if (!row) return null;
  if (!row.storageKey) return row;
  const store = getBlobStore();
  if (!store) throw new ArtifactError(`${row.path} is in the file bucket, but the bucket isn't configured on the server`);
  return { ...row, content: await store.get(row.storageKey) };
}

export async function setArtifactStatus(id: string, status: Artifact["status"]): Promise<void> {
  await db.update(artifacts).set({ status }).where(eq(artifacts.id, id));
}

export class ArtifactError extends Error {}

/** Relative, forward slashes, no "..": the same file always gets the same name. */
export function normalizeArtifactPath(path: string): string {
  const parts = path
    .replace(/\\/g, "/")
    .replace(/^\/home\/user\/work\//, "")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..");
  const clean = parts.join("/").slice(0, 300);
  if (!clean) throw new ArtifactError("Give the file a name");
  return clean;
}

const EXT: Record<string, [ArtifactKind, string]> = {
  ts: ["code", "text/plain"], tsx: ["code", "text/plain"], js: ["code", "text/javascript"], mjs: ["code", "text/javascript"],
  jsx: ["code", "text/plain"], py: ["code", "text/x-python"], go: ["code", "text/plain"], rs: ["code", "text/plain"],
  java: ["code", "text/plain"], rb: ["code", "text/plain"], sh: ["code", "text/x-shellscript"], sql: ["code", "text/plain"],
  css: ["code", "text/css"], c: ["code", "text/plain"], cpp: ["code", "text/plain"], h: ["code", "text/plain"],
  html: ["website", "text/html"], htm: ["website", "text/html"],
  md: ["document", "text/markdown"], txt: ["document", "text/plain"], docx: ["document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  pptx: ["document", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  pdf: ["pdf", "application/pdf"],
  png: ["image", "image/png"], jpg: ["image", "image/jpeg"], jpeg: ["image", "image/jpeg"], gif: ["image", "image/gif"],
  webp: ["image", "image/webp"], svg: ["image", "image/svg+xml"],
  json: ["data", "application/json"], csv: ["data", "text/csv"], yaml: ["data", "text/yaml"], yml: ["data", "text/yaml"],
  xml: ["data", "application/xml"], xlsx: ["data", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  zip: ["other", "application/zip"],
};

export function classifyArtifact(path: string, content: Buffer): { kind: ArtifactKind; mimeType: string } {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const known = EXT[ext];
  if (known) return { kind: known[0], mimeType: known[1] };
  // Unknown extension: text if it has no NUL bytes in the first 8 KB.
  const text = !content.subarray(0, 8192).includes(0);
  return { kind: "other", mimeType: text ? "text/plain" : "application/octet-stream" };
}

// ---------------------------------------------------------------- helpers

export class ConflictError extends Error {}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
