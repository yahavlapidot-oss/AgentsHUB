/**
 * Runs the "hosted" agents: agents you create on the board that AgentsHUB drives
 * itself through the Claude, OpenAI or Gemini API. Every few seconds it looks
 * for an idle hosted agent and a task it can take, then runs a tool-use loop
 * with the board's tools until the agent calls complete_task.
 *
 * Control works the same as for outside agents: pause, resume, stop and
 * redirect commands are read between model turns; request_approval waits for
 * your decision on the Approvals page.
 */
import { AGENT_TOOLS, findTool, ToolInputError, type ToolContext } from "../agent-tools";
import { gateAction, type GateResult } from "../control";
import {
  addEvent,
  addUsage,
  claimTask,
  completeCommand,
  ConflictError,
  endRun,
  getAgents,
  getCommands,
  getHostedAgents,
  getEvents,
  getInbox,
  getTask,
  getTasks,
  heartbeat,
  startRun,
  takePendingCommands,
  updateTask,
} from "../data";
import { boardLink, notifyByEmail } from "../notify";
import { costUsd } from "../pricing";
import type { Agent, Task } from "../schema";
import { createChat, MissingKeyError, type ToolOutput } from "./providers";

const TICK_MS = Number(process.env.RUNNER_TICK_MS ?? 10_000);
const MAX_TURNS = Number(process.env.RUNNER_MAX_TURNS ?? 40);
const POLL_MS = 5_000;

const SYSTEM = `You are an AI agent working on AgentsHUB, the board where your user tracks and directs a team of agents.
You have been given one task. Work on it using the board tools:
- report_progress after each meaningful step (a short note and a percentage).
- If the task is big, split it with create_subtasks. Assign pieces to other agents (see list_agents) when their skills fit better, or leave them unassigned. Subtasks you keep for yourself will be given to you later as separate tasks; don't do them now.
- Talk to other agents with send_message. The user reads that chat too.
- Before anything irreversible, anything that costs money, or anything that publishes or sends something outside, call request_approval and only proceed on 'allow'.
- Your result is the text you write: put the full deliverable in complete_task's summary (or in a message), since you have no file system.
- Finish with complete_task. If you cannot finish, explain why in report_progress and then call complete_task with what you have.`;

type Job = { agentId: string; taskId: string; startedAt: number };

const state = globalThis as unknown as { agentshubRunner?: { timer: NodeJS.Timeout; jobs: Map<string, Job> } };

/** Starts the background loop once per server process. */
export function startRunner(): void {
  if (state.agentshubRunner) return;
  const jobs = new Map<string, Job>();
  const timer = setInterval(() => void tick(jobs), TICK_MS);
  timer.unref?.();
  state.agentshubRunner = { timer, jobs };
  console.log(`[runner] hosted agents runner started (every ${TICK_MS / 1000}s)`);
  void tick(jobs);
}

let ticking = false;

async function tick(jobs: Map<string, Job>): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const hosted = await getHostedAgents();
    for (const agent of hosted) {
      if (jobs.has(agent.id)) continue;
      // Keep idle hosted agents visible as online; paused ones stay paused.
      await heartbeat(agent.id, {});
      if (agent.status === "paused") continue;
      const task = await pickTask(agent);
      if (!task) continue;
      const job = { agentId: agent.id, taskId: task.id, startedAt: Date.now() };
      jobs.set(agent.id, job);
      void runTask(agent, task).finally(() => jobs.delete(agent.id));
    }
  } catch (e) {
    console.error("[runner] tick failed", e);
  } finally {
    ticking = false;
  }
}

/** Own unfinished work first, then work assigned to it, then any ready task nobody owns. */
export async function pickTask(agent: Pick<Agent, "id">): Promise<Task | null> {
  const tasks = await getTasks();
  const done = new Set(tasks.filter((t) => t.column === "done" || t.column === "review").map((t) => t.id));
  const unblocked = (t: Task) => t.dependsOn.every((d) => done.has(d));
  const byPriority = (a: Task, b: Task) => rank(b.priority) - rank(a.priority) || a.createdAt - b.createdAt;
  const candidates = [
    tasks.filter((t) => t.ownerAgentId === agent.id && t.column === "in_progress"),
    tasks.filter((t) => t.ownerAgentId === agent.id && t.column === "ready"),
    tasks.filter((t) => !t.ownerAgentId && t.column === "ready"),
  ];
  for (const group of candidates) {
    const pick = group.filter(unblocked).sort(byPriority)[0];
    if (pick) return pick;
  }
  return null;
}

function rank(p: Task["priority"]): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[p];
}

export async function runTask(agent: Agent, task: Task): Promise<void> {
  try {
    await claimTask(agent.id, task.id);
  } catch (e) {
    if (e instanceof ConflictError) return; // someone else took it first
    throw e;
  }
  const run = await startRun(agent.id, { taskId: task.id, model: agent.model });
  let outcome: "success" | "failed" | "cancelled" = "failed";
  try {
    outcome = await loop(agent, task, run.id);
  } catch (e) {
    const message = e instanceof MissingKeyError ? e.message : `Agent crashed: ${(e as Error).message ?? e}`;
    console.error(`[runner] ${agent.name} on ${task.id}:`, e);
    await failTask(agent, task, run.id, message);
  } finally {
    await endRun(agent.id, run.id, outcome);
    await heartbeat(agent.id, { currentTaskId: null });
  }
}

async function loop(agent: Agent, task: Task, runId: string): Promise<"success" | "failed" | "cancelled"> {
  const chat = createChat({
    provider: agent.provider,
    model: agent.model,
    system: agent.instructions ? `${SYSTEM}\n\nYour own instructions from the user:\n${agent.instructions}` : SYSTEM,
    tools: AGENT_TOOLS,
  });

  const ctx: ToolContext = { agent, waitForApproval: (gate) => waitForDecision(agent, gate) };

  let lastInboxCheck = Date.now();
  let input: { text?: string; toolOutputs?: ToolOutput[] } = { text: await brief(agent, task) };
  let nudges = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await chat.send(input);
    await addUsage(agent.id, runId, {
      tokensIn: res.usage.tokensIn,
      tokensOut: res.usage.tokensOut,
      costUsd: costUsd(res.model, res.usage.tokensIn, res.usage.tokensOut),
    });
    await heartbeat(agent.id, { status: "active", currentTaskId: task.id, model: res.model });

    if (res.stopProblem) {
      await failTask(agent, task, runId, res.stopProblem);
      return "failed";
    }
    if (res.text.trim()) {
      await addEvent({ agentId: agent.id, taskId: task.id, runId, type: "note", payload: { text: res.text.slice(0, 4_000) } });
    }

    // Commands and new messages from the user arrive between turns.
    const control = await readControl(agent, task, lastInboxCheck);
    lastInboxCheck = Date.now();
    if (control.stop) {
      await addEvent({ agentId: agent.id, taskId: task.id, runId, type: "status_change", payload: { text: "Stopped by you" } });
      await updateTask(task.id, { column: "ready", ownerAgentId: null }, { agentId: agent.id });
      return "cancelled";
    }

    if (!res.toolCalls.length) {
      const current = await getTask(task.id);
      if (current && (current.column === "review" || current.column === "done")) return "success";
      if (nudges++ >= 2) {
        await failTask(agent, task, runId, "The agent stopped without finishing the task");
        return "failed";
      }
      input = {
        text: [control.note, "If the task is finished, call complete_task with the result. Otherwise keep working."]
          .filter(Boolean)
          .join("\n\n"),
      };
      continue;
    }

    const outputs: ToolOutput[] = [];
    let completed = false;
    for (const call of res.toolCalls) {
      const tool = findTool(call.name);
      if (!tool) {
        outputs.push({ id: call.id, name: call.name, output: `Unknown tool ${call.name}`, isError: true });
        continue;
      }
      try {
        const result = await tool.run(call.args, ctx);
        outputs.push({ id: call.id, name: call.name, output: JSON.stringify(result).slice(0, 50_000) });
        if (call.name === "complete_task") completed = true;
      } catch (e) {
        const known = e instanceof ToolInputError || e instanceof ConflictError;
        if (!known) console.error(`[runner] tool ${call.name} failed`, e);
        outputs.push({ id: call.id, name: call.name, output: known ? (e as Error).message : "Internal error", isError: true });
      }
      if (!QUIET_TOOLS.has(call.name)) {
        await addEvent({
          agentId: agent.id,
          taskId: task.id,
          runId,
          type: "tool_call",
          payload: { tool: call.name, input: shorten(call.args) },
        });
      }
    }
    if (completed) return "success";
    input = { toolOutputs: outputs, text: control.note };
  }

  await failTask(agent, task, runId, `Stopped after ${MAX_TURNS} model turns without finishing`);
  return "failed";
}

/** Logs the problem, puts the task in front of the user and emails them. */
async function failTask(agent: Agent, task: Task, runId: string, text: string): Promise<void> {
  await addEvent({ agentId: agent.id, taskId: task.id, runId, type: "error", payload: { text } });
  await updateTask(task.id, { column: "waiting_on_you" }, { agentId: agent.id });
  await notifyByEmail(
    `[AgentsHUB] ${agent.name} got stuck on "${task.title}"`,
    `${text}\n\nThe task is now in "Waiting on you".\n${boardLink("/")}`,
  );
}

/** Tools that already write their own activity line. */
const QUIET_TOOLS = new Set(["report_progress", "log_activity", "complete_task", "send_message"]);

/** Handles pause (waits here), stop, and redirect commands, and collects new messages for the agent. */
async function readControl(agent: Agent, task: Task, since: number): Promise<{ stop: boolean; note?: string }> {
  const notes: string[] = [];
  for (let paused = false; ; ) {
    const commands = await takePendingCommands(agent.id);
    for (const c of commands) {
      await completeCommand(agent.id, c.id);
      if (c.type === "stop") return { stop: true };
      if (c.type === "pause") paused = true;
      if (c.type === "resume") paused = false;
      if (c.type === "redirect" && c.text) notes.push(`Your user redirected you: ${c.text}`);
    }
    if (!paused) break;
    await sleep(POLL_MS);
    await heartbeat(agent.id, {});
  }
  const inbox = await getInbox(agent.id, since);
  for (const m of inbox) {
    const who = m.fromAgentId ? `agent ${m.fromAgentId}` : "your user";
    notes.push(`New message from ${who}${m.taskId && m.taskId !== task.id ? ` (about task ${m.taskId})` : ""}: ${m.text}`);
  }
  return { stop: false, note: notes.length ? notes.join("\n") : undefined };
}

/** Waits on the Approvals page. Re-asks the gate until the user decides or sends stop. */
async function waitForDecision(agent: Agent, gate: GateResult): Promise<GateResult> {
  let current = gate;
  while (current.decision === "ask") {
    await sleep(POLL_MS);
    // Leave the stop command in place; the main loop reads it right after this tool returns.
    const commands = await getCommands(agent.id);
    if (commands.some((c) => c.type === "stop" && c.status === "pending")) break;
    await heartbeat(agent.id, { status: "waiting" });
    current = await gateAction(agent.id, { action: current.approval.action, force: true });
  }
  return current;
}

async function brief(agent: Agent, task: Task): Promise<string> {
  const [all, agents, history] = await Promise.all([getTasks(), getAgents(), getEvents({ taskId: task.id, limit: 20 })]);
  const subtasks = all.filter((t) => t.parentTaskId === task.id);
  const parent = task.parentTaskId ? all.find((t) => t.id === task.parentTaskId) : null;
  const lines = [
    `Your task (id ${task.id}): ${task.title}`,
    task.description && `Description:\n${task.description}`,
    task.acceptanceCriteria && `Done when:\n${task.acceptanceCriteria}`,
    parent && `This is part of a bigger task: "${parent.title}" (${parent.id}).`,
    subtasks.length && `Existing subtasks:\n${subtasks.map((s) => `- ${s.title} [${s.column}]`).join("\n")}`,
    history.length &&
      `Earlier activity on this task (newest first):\n${history
        .map((e) => `- ${e.type}: ${String((e.payload as { text?: string }).text ?? "").slice(0, 300)}`)
        .join("\n")}`,
    `Other agents: ${agents
      .filter((a) => a.id !== agent.id)
      .map((a) => `${a.name} (${a.id}, skills: ${a.skills.join(", ") || "general"})`)
      .join("; ") || "none"}`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

function shorten(args: unknown): unknown {
  const s = JSON.stringify(args ?? {});
  return s.length > 1_000 ? `${s.slice(0, 1_000)}…` : args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
