import { sqliteTable, text, integer, real, index, blob, uniqueIndex } from "drizzle-orm/sqlite-core";

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
/** "expired": nobody decided in time, or an approval wasn't used while it was valid. */
export const DECISIONS = ["pending", "approved", "denied", "expired"] as const;
/** standard: asks for what the approval policy flags. cautious: also asks before every command on its cloud computer and every public link. */
export const AUTONOMY_LEVELS = ["standard", "cautious"] as const;
export const SANDBOX_STATUSES = ["starting", "running", "closed", "failed"] as const;
export const ARTIFACT_KINDS = ["code", "document", "image", "pdf", "data", "website", "other"] as const;
export const ARTIFACT_STATUSES = ["draft", "in_review", "approved", "failed"] as const;
export const PROJECT_STATUSES = ["active", "paused", "done"] as const;

export type Provider = (typeof PROVIDERS)[number];
export type AgentRole = (typeof AGENT_ROLES)[number];
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type Column = (typeof COLUMNS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

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
  /** Hosted agents: may open a cloud computer (sandbox) to write and run code. */
  sandboxEnabled: integer("sandbox_enabled", { mode: "boolean" }).notNull().default(false),
  autonomy: text("autonomy", { enum: AUTONOMY_LEVELS }).notNull().default("standard"),
  /** Tools you turned off for this agent (see src/lib/tool-hub.ts). */
  disabledTools: text("disabled_tools", { mode: "json" }).$type<string[]>().notNull().default([]),
  status: text("status", { enum: AGENT_STATUSES }).notNull().default("offline"),
  currentTaskId: text("current_task_id"),
  lastHeartbeat: integer("last_heartbeat"),
  tokenHash: text("token_hash").notNull().unique(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/**
 * A project groups tasks, and its tasks share one workspace: the files any of
 * them saved, which the next agent's cloud computer starts from. Its goal and
 * requirements go into every brief. memberAgentIds limits who may take its
 * tasks and change its files; empty means every agent.
 */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  goal: text("goal").notNull().default(""),
  /** Requirements, constraints and decisions every agent on the project should know. */
  context: text("context").notNull().default(""),
  memberAgentIds: text("member_agent_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** The project's work manager: you chat with it in the project chat, and new project tasks go to it to plan and hand out. */
  leadAgentId: text("lead_agent_id"),
  /** Spending cap over all the project's tasks (models plus cloud computers). Agents stop at it. */
  budgetUsd: real("budget_usd"),
  status: text("status", { enum: PROJECT_STATUSES }).notNull().default("active"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
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
    projectId: text("project_id"),
    dependsOn: text("depends_on", { mode: "json" }).$type<string[]>().notNull().default([]),
    acceptanceCriteria: text("acceptance_criteria").notNull().default(""),
    progressPct: integer("progress_pct").notNull().default(0),
    budgetUsd: real("budget_usd"),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("tasks_column_idx").on(t.column), index("tasks_owner_idx").on(t.ownerAgentId), index("tasks_project_idx").on(t.projectId)],
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
  (t) => [index("runs_agent_idx").on(t.agentId), index("runs_task_idx").on(t.taskId), index("runs_started_idx").on(t.startedAt)],
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
  (t) => [index("events_task_idx").on(t.taskId), index("events_at_idx").on(t.at), index("events_run_idx").on(t.runId)],
);

/**
 * Agent-to-agent (and user-to-agent) chat. fromAgentId null means the user wrote it.
 * projectId puts the message in that project's chat with its lead.
 */
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    fromAgentId: text("from_agent_id"),
    toAgentId: text("to_agent_id"),
    taskId: text("task_id"),
    projectId: text("project_id"),
    text: text("text").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("messages_at_idx").on(t.at), index("messages_project_idx").on(t.projectId)],
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
  /** Where the action happens, e.g. "GitHub", "Email", "Payments". */
  service: text("service").notNull().default(""),
  /** What will be sent or changed outside, so you can see it before deciding. */
  details: text("details").notNull().default(""),
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

/**
 * One agent's own memory: what it learned about how its user wants things done,
 * its own conventions and lessons. Only that agent sees it (and the user, on the
 * agent page). Shared knowledge goes in the team notes instead. One entry per title.
 */
export const agentMemories = sqliteTable(
  "agent_memories",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    taskId: text("task_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("agent_memories_agent_title").on(t.agentId, t.title)],
);

/** Server-wide switches, e.g. the emergency stop. One JSON value per key. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Cloud computers (see src/lib/sandbox). One per hosted run that needs one; closed when the run ends. */
export const sandboxes = sqliteTable(
  "sandboxes",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    taskId: text("task_id"),
    runId: text("run_id"),
    provider: text("provider").notNull(),
    /** The provider's own id, used to kill a sandbox left behind by a crash. */
    externalId: text("external_id"),
    status: text("status", { enum: SANDBOX_STATUSES }).notNull().default("starting"),
    commands: integer("commands").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    error: text("error"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
  },
  (t) => [index("sandboxes_status_idx").on(t.status), index("sandboxes_task_idx").on(t.taskId)],
);

/**
 * Files agents deliver. Every save of the same path on a task adds a new
 * version; older versions stay. Content lives in the database for now (files
 * are capped in size), so it survives the sandbox being deleted.
 */
export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id"),
    /** Set from the task's project: files of a project form its shared workspace, versioned per path. */
    projectId: text("project_id"),
    agentId: text("agent_id"),
    runId: text("run_id"),
    sandboxId: text("sandbox_id"),
    path: text("path").notNull(),
    version: integer("version").notNull().default(1),
    kind: text("kind", { enum: ARTIFACT_KINDS }).notNull().default("other"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    note: text("note").notNull().default(""),
    status: text("status", { enum: ARTIFACT_STATUSES }).notNull().default("draft"),
    /** The bytes, when they live in the database. Empty when storageKey is set. */
    content: blob("content", { mode: "buffer" }).notNull(),
    /** Object key in the bucket (see src/lib/storage.ts), or null when the bytes are in `content`. */
    storageKey: text("storage_key"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("artifacts_task_idx").on(t.taskId), index("artifacts_project_idx").on(t.projectId), uniqueIndex("artifacts_task_path_version").on(t.taskId, t.path, t.version)],
);

export const SCHEDULE_FREQUENCIES = ["minutes", "hourly", "daily", "weekly", "monthly"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

/**
 * Recurring work: at each due time the scheduler adds a task to Ready with these
 * fields, for the chosen agent (or whoever picks it up). Times are wall-clock in
 * `timezone`, so "daily at 08:00" stays 08:00 across daylight saving.
 */
export const schedules = sqliteTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    acceptanceCriteria: text("acceptance_criteria").notNull().default(""),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
    projectId: text("project_id"),
    ownerAgentId: text("owner_agent_id"),
    frequency: text("frequency", { enum: SCHEDULE_FREQUENCIES }).notNull().default("daily"),
    /** For "minutes": how many minutes between runs (at least 15). */
    intervalMinutes: integer("interval_minutes"),
    /** "HH:MM" for daily, weekly and monthly; for hourly only the minutes count. */
    timeOfDay: text("time_of_day").notNull().default("08:00"),
    /** Weekly: days to run, 0 = Sunday. */
    weekdays: text("weekdays", { mode: "json" }).$type<number[]>().notNull().default([]),
    /** Monthly: day of the month (1-28). */
    dayOfMonth: integer("day_of_month"),
    timezone: text("timezone").notNull().default("Asia/Jerusalem"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Don't add a new task while the last one is still open, so missed runs don't pile up. */
    skipIfOpen: integer("skip_if_open", { mode: "boolean" }).notNull().default(true),
    nextRunAt: integer("next_run_at"),
    lastRunAt: integer("last_run_at"),
    lastTaskId: text("last_task_id"),
    runCount: integer("run_count").notNull().default(0),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("schedules_next_idx").on(t.nextRunAt)],
);

export const CONNECTION_SERVICES = ["github", "google", "railway", "mcp"] as const;
export type ConnectionService = (typeof CONNECTION_SERVICES)[number];

/**
 * Accounts and servers agents may use: a GitHub token, a Google sign-in, a
 * Railway token, an MCP server. The secret is encrypted (see src/lib/vault.ts);
 * `meta` holds what isn't secret (the account name, a server address, scopes).
 * agentIds limits which agents may use it; empty means every hosted agent.
 */
export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  service: text("service", { enum: CONNECTION_SERVICES }).notNull(),
  label: text("label").notNull(),
  secret: text("secret").notNull().default(""),
  meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  agentIds: text("agent_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastError: text("last_error"),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type AgentEvent = typeof events.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Command = typeof commands.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type AgentMemory = typeof agentMemories.$inferSelect;
export type Sandbox = typeof sandboxes.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type Connection = typeof connections.$inferSelect;
/** A connection as the UI sees it: never the secret. */
export type PublicConnection = Omit<Connection, "secret"> & { hasSecret: boolean };
/** Artifact without its bytes, for lists. */
export type ArtifactInfo = Omit<Artifact, "content">;

/** Agent as the UI sees it: never includes the token hash. */
export type PublicAgent = Omit<Agent, "tokenHash">;
