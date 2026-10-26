/**
 * Spending: what agents cost, split into model API calls and cloud computers,
 * and the caps that stop them. There are three caps, all optional:
 *
 * - a task's budget (on the task),
 * - a project's budget (over all its tasks),
 * - a monthly cap for the whole hub (kept in settings, set on the Usage page).
 *
 * At 80% of a project or monthly cap you get one email; at 100% agents stop
 * working on it and the task waits for you.
 */
import { eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { getProject, getSetting, getTask, getTaskCost, setSetting } from "./data";
import { boardLink, notify } from "./notify";
import { runs, sandboxes, tasks } from "./schema";

export const ALERT_AT = 0.8;
const MONTHLY_CAP_KEY = "monthly_budget_usd";
const ALERTS_KEY = "budget_alerts_sent";

export type Spend = { models: number; computers: number; total: number };

const spend = (total: number, computers: number): Spend => ({
  total,
  computers,
  models: Math.max(0, total - computers),
});

/** The first moment of the current month (UTC), when the monthly cap starts over. */
export function monthStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export async function getMonthlyCap(): Promise<number | null> {
  return getSetting<number>(MONTHLY_CAP_KEY);
}

export async function setMonthlyCap(usd: number | null): Promise<void> {
  await setSetting(MONTHLY_CAP_KEY, usd != null && usd > 0 ? usd : null);
}

/**
 * Spend since a moment. Cloud computer time is added to the run's cost when
 * the computer closes, so models = runs minus computers.
 */
export async function getSpend(since = 0): Promise<Spend> {
  const [r] = await db.select({ c: sql<number>`coalesce(sum(${runs.costUsd}), 0)` }).from(runs).where(gte(runs.startedAt, since));
  const [s] = await db.select({ c: sql<number>`coalesce(sum(${sandboxes.costUsd}), 0)` }).from(sandboxes).where(gte(sandboxes.startedAt, since));
  return spend(Number(r?.c ?? 0), Number(s?.c ?? 0));
}

/** Spend per project, split the same way. */
export async function getSpendByProject(): Promise<Map<string, Spend>> {
  const r = await db
    .select({ id: tasks.projectId, c: sql<number>`coalesce(sum(${runs.costUsd}), 0)` })
    .from(runs)
    .innerJoin(tasks, eq(runs.taskId, tasks.id))
    .groupBy(tasks.projectId);
  const s = await db
    .select({ id: tasks.projectId, c: sql<number>`coalesce(sum(${sandboxes.costUsd}), 0)` })
    .from(sandboxes)
    .innerJoin(tasks, eq(sandboxes.taskId, tasks.id))
    .groupBy(tasks.projectId);
  const computers = new Map(s.filter((x) => x.id).map((x) => [x.id!, Number(x.c)]));
  return new Map(r.filter((x) => x.id).map((x) => [x.id!, spend(Number(x.c), computers.get(x.id!) ?? 0)]));
}

/** Cloud computer spend per agent or per model (of the run it ran in), for the Usage page. */
export async function getComputerSpend(groupBy: "agent" | "model"): Promise<Map<string, number>> {
  const key = groupBy === "agent" ? sandboxes.agentId : runs.model;
  const rows = await db
    .select({ id: sql<string>`${key}`, c: sql<number>`coalesce(sum(${sandboxes.costUsd}), 0)` })
    .from(sandboxes)
    .innerJoin(runs, eq(sandboxes.runId, runs.id))
    .groupBy(key);
  return new Map(rows.map((x) => [x.id, Number(x.c)]));
}

export async function getProjectSpend(projectId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`coalesce(sum(${runs.costUsd}), 0)` })
    .from(runs)
    .innerJoin(tasks, eq(runs.taskId, tasks.id))
    .where(eq(tasks.projectId, projectId));
  return Number(row?.c ?? 0);
}

/**
 * Why the agent must stop working on this task, or null. Checks the task's,
 * its project's and the monthly cap, counting the cloud computer that's still
 * running (`running`, not yet in the totals). Sends the 80% emails.
 */
export async function budgetProblem(taskId: string, running = 0): Promise<string | null> {
  // Read everything fresh: you may change a budget while the agent works.
  const task = await getTask(taskId);
  if (!task) return null;

  if (task.budgetUsd != null) {
    const spent = (await getTaskCost(task.id)) + running;
    if (spent >= task.budgetUsd) return `Stopped: the task's budget of $${task.budgetUsd.toFixed(2)} is used up ($${spent.toFixed(2)} spent)`;
  }

  const project = task.projectId ? await getProject(task.projectId) : null;
  if (project?.budgetUsd != null) {
    const spent = (await getProjectSpend(project.id)) + running;
    if (spent >= project.budgetUsd) {
      return `Stopped: the project "${project.name}" used up its budget of $${project.budgetUsd.toFixed(2)} ($${spent.toFixed(2)} spent)`;
    }
    await alertOnce(`project:${project.id}:${project.budgetUsd}`, spent, project.budgetUsd, `the project "${project.name}"`, `/projects/${project.id}`);
  }

  const cap = await getMonthlyCap();
  if (cap != null) {
    const start = monthStart();
    const spent = (await getSpend(start)).total + running;
    if (spent >= cap) return `Stopped: this month's spending cap of $${cap.toFixed(2)} is used up ($${spent.toFixed(2)} spent)`;
    await alertOnce(`month:${start}:${cap}`, spent, cap, "this month's spending cap", "/usage");
  }
  return null;
}

/** One email per cap (and per cap amount, so raising it re-arms the alert). */
async function alertOnce(key: string, spent: number, cap: number, what: string, path: string): Promise<void> {
  if (spent < cap * ALERT_AT) return;
  const sent = (await getSetting<string[]>(ALERTS_KEY)) ?? [];
  if (sent.includes(key)) return;
  await setSetting(ALERTS_KEY, [...sent.slice(-200), key]);
  await notify(
    `[AgentsHUB] ${Math.round((spent / cap) * 100)}% of ${what} is used`,
    `$${spent.toFixed(2)} of $${cap.toFixed(2)} spent. Agents stop at the cap.\n${boardLink(path)}`,
    { kind: "budget" },
  );
}

/** For the Usage page: how far into the monthly cap we are. */
export async function getMonthStatus(): Promise<{ cap: number | null; spent: Spend; since: number }> {
  const since = monthStart();
  const [cap, spent] = await Promise.all([getMonthlyCap(), getSpend(since)]);
  return { cap, spent, since };
}

