import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const PROVIDERS = ["anthropic", "openai", "google", "custom"] as const;
/** "hosted" agents are run by AgentsHUB itself (see src/lib/runner); the rest connect from outside. */
export const AGENT_KINDS = ["claude_code", "mcp", "sdk", "hosted"] as const;
/** A "lead" plans: it takes new top-level tasks, splits them and hands the pieces to the team. */
export const AGENT_ROLES = ["member", "lead"] as const;
export const AGENT_STATUSES = ["active", "waiting", "paused", "offline"] as const;
export const COLUMNS = ["backlog", "ready", "in_progress", "waiting_on_you", "review", "done"] as const;
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const EVENT_TYPES = ["tool_call", "file_edit", "note", "error", "status_change"] as const;
export const COMMAND_TYPES = ["pause", "resume", "redirect", "stop"] as const;
export const RISKS = ["low", "medium", "high"] as const;
export const DECISIONS = ["pending", "approved", "denied"] as const;

export type Provider = (typeof PROVIDERS)[number];
export type AgentRole = (typeof AGENT_ROLES)[number];
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type Column = (typeof COLUMNS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type EventType = (typeof EVENT_TYPES)[number];

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider", { enum: PROVIDERS }).notNull(),
  kind: text("kind", { enum: AGENT_KINDS }).notNull().default("sdk"),
  model: text("model").notNull(),
  machine: text("machine"),
  skills: text("skills", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** System prompt for hosted agents. */
  instructions: text("instructions").notNull().default(""),
  role: text("role", { enum: AGENT_ROLES }).notNull().default("member"),
  /** Hosted agents: messages up to this time have been shown to the agent. */
  inboxReadAt: integer("inbox_read_at"),
  status: text("status", { enum: AGENT_STATUSES }).notNull().default("offline"),
  currentTaskId: text("current_task_id"),
  lastHeartbeat: integer("last_heartbeat"),
  tokenHash: text("token_hash").notNull().unique(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    column: text("column", { enum: COLUMNS }).notNull().default("backlog"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
    ownerAgentId: text("owner_agent_id"),
    parentTaskId: text("parent_task_id"),
    dependsOn: text("depends_on", { mode: "json" }).$type<string[]>().notNull().default([]),
    acceptanceCriteria: text("acceptance_criteria").notNull().default(""),
    progressPct: integer("progress_pct").notNull().default(0),
    budgetUsd: real("budget_usd"),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("tasks_column_idx").on(t.column), index("tasks_owner_idx").on(t.ownerAgentId)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    taskId: text("task_id"),
    model: text("model").notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    outcome: text("outcome", { enum: ["success", "failed", "cancelled"] }),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
  },
  (t) => [index("runs_agent_idx").on(t.agentId)],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id"),
    agentId: text("agent_id"),
    taskId: text("task_id"),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    at: integer("at").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("events_task_idx").on(t.taskId), index("events_at_idx").on(t.at)],
);

/** Agent-to-agent (and user-to-agent) chat. fromAgentId null means the user wrote it. */
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    fromAgentId: text("from_agent_id"),
    toAgentId: text("to_agent_id"),
    taskId: text("task_id"),
    text: text("text").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("messages_at_idx").on(t.at)],
);

export const commands = sqliteTable("commands", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  type: text("type", { enum: COMMAND_TYPES }).notNull(),
  text: text("text").notNull().default(""),
  status: text("status", { enum: ["pending", "delivered", "done"] }).notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  taskId: text("task_id"),
  action: text("action").notNull(),
  reason: text("reason").notNull().default(""),
  risk: text("risk", { enum: RISKS }).notNull().default("medium"),
  decision: text("decision", { enum: DECISIONS }).notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
  decidedAt: integer("decided_at"),
  /** Set when an approved action is actually carried out, so one approval covers one run of it. */
  consumedAt: integer("consumed_at"),
});

/** Team notes: shared memory every agent (and the user) can read and write. One note per title. */
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull().unique(),
  text: text("text").notNull(),
  /** null means the user wrote it. */
  authorAgentId: text("author_agent_id"),
  taskId: text("task_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type AgentEvent = typeof events.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Command = typeof commands.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Note = typeof notes.$inferSelect;

/** Agent as the UI sees it: never includes the token hash. */
export type PublicAgent = Omit<Agent, "tokenHash">;
