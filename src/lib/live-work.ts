/**
 * What agents are doing right now, for the Live workspace: each open run with
 * its agent, task, the commands and notes of the run so far, and the cloud
 * computer it's using.
 */
import { and, desc, gte, isNull } from "drizzle-orm";
import { db } from "./db";
import { getAgents, getEvents, getOpenSandboxes, getTasks } from "./data";
import { sandboxCost } from "./sandbox/session";
import { runs, type AgentEvent, type PublicAgent, type Run, type Sandbox, type Task } from "./schema";

/** A run that was never ended (the server restarted) stops counting as live after this. */
const STALE_MS = 6 * 60 * 60_000;
const EVENTS_PER_RUN = 150;

export type LiveRun = {
  run: Run;
  agent: PublicAgent | null;
  task: Task | null;
  events: AgentEvent[];
  sandbox: (Sandbox & { runningCostUsd: number }) | null;
};

export async function getLiveWork(now = Date.now()): Promise<{ runs: LiveRun[]; idle: PublicAgent[]; generatedAt: number }> {
  const open = await db
    .select()
    .from(runs)
    .where(and(isNull(runs.endedAt), gte(runs.startedAt, now - STALE_MS)))
    .orderBy(desc(runs.startedAt))
    .limit(30);
  const [agents, tasks, sandboxes] = await Promise.all([getAgents(), open.length ? getTasks() : [], getOpenSandboxes()]);
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const live = await Promise.all(
    open.map(async (run): Promise<LiveRun> => {
      const box = sandboxes.find((s) => s.runId === run.id) ?? null;
      return {
        run,
        agent: agentById.get(run.agentId) ?? null,
        task: run.taskId ? taskById.get(run.taskId) ?? null : null,
        // Oldest first, like a terminal.
        events: (await getEvents({ runId: run.id, limit: EVENTS_PER_RUN })).reverse(),
        sandbox: box && { ...box, runningCostUsd: sandboxCost(now - box.startedAt) },
      };
    }),
  );
  const busy = new Set(open.map((r) => r.agentId));
  return { runs: live, idle: agents.filter((a) => !busy.has(a.id)), generatedAt: now };
}

