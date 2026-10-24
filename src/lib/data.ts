/**
 * The one data-access module. UI pages, server actions and the agent API all go
 * through here, so the storage (or a future realtime server) can change without
 * touching components.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { newId } from "./ids";
import { boardLink, notifyByEmail } from "./notify";
import { generateAgentToken, hashToken } from "./tokens";
import {
  agents,
  approvals,
  commands,
  events,
  messages,
  runs,
  tasks,
  type Agent,
  type AgentEvent,
  type Approval,
  type Column,
  type Command,
  type EventType,
  type Message,
  type Priority,
  type Provider,
  type PublicAgent,
  type Run,
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
  opts: { taskId?: string; agentId?: string; limit?: number } = {},
): Promise<AgentEvent[]> {
  const where = and(
    opts.taskId ? eq(events.taskId, opts.taskId) : undefined,
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
  generatedAt: number;
};

/** Everything the live board needs in one round trip. */
export async function getSnapshot(): Promise<Snapshot> {
  const [a, t, e, m, ap] = await Promise.all([
    getAgents(),
    getTasks(),
    getEvents({ limit: 60 }),
    getMessages({ limit: 100 }),
    getApprovals({ pendingOnly: true }),
  ]);
  return { agents: a, tasks: t, events: e, messages: m, approvals: ap, generatedAt: Date.now() };
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

export async function deleteAgent(agentId: string): Promise<void> {
  await db.update(tasks).set({ ownerAgentId: null }).where(eq(tasks.ownerAgentId, agentId));
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
}): Promise<Task> {
  const now = Date.now();
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
    "title" | "description" | "column" | "priority" | "ownerAgentId" | "acceptanceCriteria" | "progressPct" | "budgetUsd"
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
  input: { taskId?: string | null; action: string; reason?: string; risk?: Approval["risk"] },
): Promise<Approval> {
  const [row] = await db
    .insert(approvals)
    .values({
      id: newId("apr"),
      agentId,
      taskId: input.taskId ?? null,
      action: input.action,
      reason: input.reason ?? "",
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
      row.reason ? `Why: ${row.reason}` : "",
      "",
      `Approve or deny: ${boardLink("/approvals")}`,
    ]
      .filter((l, i) => l || i === 3)
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
    await addEvent({
      agentId: null,
      taskId: row.taskId,
      type: "note",
      payload: { text: `You ${decision} "${row.action}"` },
    });
  }
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

// ---------------------------------------------------------------- helpers

export class ConflictError extends Error {}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
