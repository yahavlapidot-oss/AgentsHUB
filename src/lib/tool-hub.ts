/**
 * The Tool Hub: one catalog of every tool an agent can be given, with its
 * category and risk, and one place that decides which tools an agent gets and
 * runs its tool calls. The runner and the MCP endpoint both go through here.
 *
 * Adding a tool: define it (agent-tools.ts, sandbox/tools.ts or a new module),
 * add it to ALL_TOOLS and give it a CATALOG entry. Nothing in the runner changes.
 */
import { AGENT_TOOLS, ToolInputError, type AgentTool, type ToolContext } from "./agent-tools";
import { addEvent, ConflictError } from "./data";
import type { Agent } from "./schema";
import { SANDBOX_LOGGED_TOOLS, SANDBOX_TOOLS } from "./sandbox/tools";
import { SCHEDULE_TOOLS } from "./tools/schedule";
import { WEB_TOOLS } from "./tools/web";

export const TOOL_CATEGORIES = ["board", "team", "memory", "files", "web", "computer", "control"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/**
 * read: only looks. write: changes the board or the agent's own sandbox.
 * external: can reach or show something outside AgentsHUB (the internet, a public link).
 * Actions that are irreversible, cost money or publish still go through the approval gate on top.
 */
export const TOOL_RISKS = ["read", "write", "external"] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];

export type ToolInfo = {
  category: ToolCategory;
  risk: ToolRisk;
  /** Core tools keep the board working (finishing, reporting, asking you) and can't be turned off. */
  core?: boolean;
  /** Only for hosted agents with a cloud computer. */
  needsSandbox?: boolean;
};

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  board: "Tasks",
  team: "Team",
  memory: "Memory",
  files: "Files",
  web: "Internet",
  computer: "Cloud computer",
  control: "Reporting and approvals",
};

export const CATALOG: Record<string, ToolInfo> = {
  list_tasks: { category: "board", risk: "read" },
  get_task: { category: "board", risk: "read" },
  claim_task: { category: "board", risk: "write" },
  create_subtasks: { category: "board", risk: "write" },
  create_task: { category: "board", risk: "write" },
  list_projects: { category: "board", risk: "read" },
  hand_off: { category: "team", risk: "write" },
  read_saved_file: { category: "files", risk: "read" },
  list_agents: { category: "team", risk: "read" },
  send_message: { category: "team", risk: "write" },
  check_inbox: { category: "team", risk: "read", core: true },
  write_note: { category: "memory", risk: "write" },
  read_notes: { category: "memory", risk: "read" },
  remember: { category: "memory", risk: "write" },
  forget: { category: "memory", risk: "write" },
  search_memory: { category: "memory", risk: "read" },
  save_artifact: { category: "files", risk: "write" },
  report_progress: { category: "control", risk: "write", core: true },
  complete_task: { category: "control", risk: "write", core: true },
  request_approval: { category: "control", risk: "read", core: true },
  log_activity: { category: "control", risk: "write" },
  run_command: { category: "computer", risk: "external", needsSandbox: true },
  write_file: { category: "computer", risk: "write", needsSandbox: true },
  read_file: { category: "computer", risk: "read", needsSandbox: true },
  list_files: { category: "computer", risk: "read", needsSandbox: true },
  preview_url: { category: "computer", risk: "external", needsSandbox: true },
  schedule_task: { category: "board", risk: "write" },
  list_schedules: { category: "board", risk: "read" },
  pause_schedule: { category: "board", risk: "write" },
  web_search: { category: "web", risk: "external" },
  fetch_page: { category: "web", risk: "external" },
};

export const ALL_TOOLS: AgentTool[] = [...AGENT_TOOLS, ...SCHEDULE_TOOLS, ...WEB_TOOLS, ...SANDBOX_TOOLS];

export function toolInfo(name: string): ToolInfo {
  return CATALOG[name] ?? { category: "board", risk: "write" };
}

/** The tools an agent gets: everything it's allowed, minus what you turned off; sandbox tools only with a sandbox. */
export function toolsForAgent(agent: Pick<Agent, "disabledTools">, opts: { sandbox: boolean }): AgentTool[] {
  const off = new Set(agent.disabledTools);
  return ALL_TOOLS.filter((t) => {
    const info = toolInfo(t.name);
    if (info.needsSandbox && !opts.sandbox) return false;
    return info.core || !off.has(t.name);
  });
}

/** Names that may be turned off; core tools are dropped from the list. */
export function cleanDisabledTools(names: string[]): string[] {
  const known = new Set(ALL_TOOLS.map((t) => t.name));
  return [...new Set(names)].filter((n) => known.has(n) && !toolInfo(n).core).sort();
}

export type ToolCall = { id: string; name: string; args: unknown };
export type ToolResult = { id: string; name: string; output: string; isError?: boolean };

/** The same call (same tool, same input) this many times in one run is refused, so a stuck agent can't loop on it. */
const MAX_SAME_CALL = Number(process.env.TOOL_MAX_SAME_CALL ?? 5);
/** Tools that write their own activity line. */
const QUIET_TOOLS = new Set(["report_progress", "log_activity", "complete_task", "send_message", "save_artifact", ...SANDBOX_LOGGED_TOOLS]);
/** Calls that are meant to repeat (polling). */
const REPEATABLE = new Set(["check_inbox", "request_approval", "report_progress", "list_tasks", "get_task", "search_memory", "read_notes", "read_saved_file", "list_projects", "list_schedules"]);

/**
 * Runs one agent's tool calls for one run, the same way for every provider:
 * unknown and turned-off tools are refused, inputs are checked, errors go back
 * to the model as results it can act on, and each call is logged.
 */
export class ToolExecutor {
  private seen = new Map<string, number>();

  constructor(
    private tools: AgentTool[],
    private ctx: ToolContext,
    private log: { taskId?: string | null; runId?: string | null } = {},
  ) {}

  async run(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.find((t) => t.name === call.name);
    if (!tool) {
      const turnedOff = (this.ctx.agent as Partial<Pick<Agent, "disabledTools">>).disabledTools?.includes(call.name);
      return {
        id: call.id,
        name: call.name,
        output: turnedOff ? `${call.name} is turned off for you` : `Unknown tool ${call.name}`,
        isError: true,
      };
    }
    if (!REPEATABLE.has(call.name)) {
      const key = `${call.name}:${stableJson(call.args)}`;
      const count = (this.seen.get(key) ?? 0) + 1;
      this.seen.set(key, count);
      if (count > MAX_SAME_CALL) {
        return {
          id: call.id,
          name: call.name,
          output: `You already made this exact ${call.name} call ${MAX_SAME_CALL} times in this run. Try something different, or explain the problem in report_progress.`,
          isError: true,
        };
      }
    }
    let result: ToolResult;
    try {
      const output = await tool.run(call.args, this.ctx);
      result = { id: call.id, name: call.name, output: JSON.stringify(output).slice(0, 50_000) };
    } catch (e) {
      const known = e instanceof ToolInputError || e instanceof ConflictError;
      if (!known) console.error(`[tools] ${call.name} failed`, e);
      result = { id: call.id, name: call.name, output: known ? (e as Error).message : "Internal error", isError: true };
    }
    if (!QUIET_TOOLS.has(call.name)) {
      await addEvent({
        agentId: this.ctx.agent.id,
        taskId: this.log.taskId ?? null,
        runId: this.log.runId ?? null,
        type: "tool_call",
        payload: { tool: call.name, input: shorten(call.args), ...(result.isError ? { error: result.output.slice(0, 500) } : {}) },
      });
    }
    return result;
  }
}

function shorten(args: unknown): unknown {
  const s = JSON.stringify(args ?? {});
  return s.length > 1_000 ? `${s.slice(0, 1_000)}…` : args;
}

/** JSON with sorted keys, so {a,b} and {b,a} count as the same call. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
