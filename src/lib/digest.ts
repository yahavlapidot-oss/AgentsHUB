/**
 * The daily digest: one short message each morning with what got done, what
 * waits on you, what's in progress and what it cost. Built from the board
 * itself (no model call, so it's free), and sent by email and to your phone.
 */
import { getMonthStatus, getSpend } from "./budgets";
import { getAgents, getApprovals, getEvents, getSetting, getTasks, setSetting } from "./data";
import { boardLink } from "./notify";
import { DEFAULT_TIMEZONE, describeTiming, getSchedules, nextRunAfter } from "./schedules";

export type DigestSettings = { enabled: boolean; time: string; timezone: string };
const KEY = "digest";

export async function getDigestSettings(): Promise<DigestSettings> {
  const saved = await getSetting<Partial<DigestSettings>>(KEY);
  return { enabled: saved?.enabled ?? true, time: saved?.time ?? "08:00", timezone: saved?.timezone ?? DEFAULT_TIMEZONE };
}

export async function setDigestSettings(s: DigestSettings): Promise<void> {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) throw new Error("Time as HH:MM");
  await setSetting(KEY, s);
}

/** Due when the latest digest time (in its zone) has passed and it hasn't gone out since. */
export function digestDue(s: DigestSettings, lastRun: number | null, now: number): boolean {
  if (!s.enabled) return false;
  const timing = { frequency: "daily" as const, timeOfDay: s.time, timezone: s.timezone, intervalMinutes: null, weekdays: [], dayOfMonth: null };
  let latest = nextRunAfter(timing, now - 26 * 60 * 60_000);
  if (latest > now) return false;
  for (let next = nextRunAfter(timing, latest); next <= now; next = nextRunAfter(timing, latest)) latest = next;
  return (lastRun ?? 0) < latest;
}

const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : 0)}`;

export async function buildDigest(now = Date.now()): Promise<{ subject: string; text: string; needsYou: number }> {
  const dayAgo = now - 24 * 60 * 60_000;
  const [tasks, agents, approvals, errors, daySpend, month, schedules] = await Promise.all([
    getTasks(),
    getAgents(),
    getApprovals({ pendingOnly: true }),
    getEvents({ limit: 200 }),
    getSpend(dayAgo),
    getMonthStatus(),
    getSchedules(),
  ]);
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "unassigned";
  const finished = tasks.filter((t) => (t.column === "review" || t.column === "done") && t.updatedAt > dayAgo);
  const review = tasks.filter((t) => t.column === "review");
  const waiting = tasks.filter((t) => t.column === "waiting_on_you");
  const working = tasks.filter((t) => t.column === "in_progress");
  const problems = errors.filter((e) => e.type === "error" && e.at > dayAgo);
  const today = schedules.filter((s) => s.enabled && s.nextRunAt && s.nextRunAt < now + 24 * 60 * 60_000);
  const needsYou = approvals.length + waiting.length + review.length;

  const section = (title: string, rows: string[], empty?: string) => (rows.length ? `${title}\n${rows.join("\n")}` : empty ? `${title}\n${empty}` : null);
  const text = [
    needsYou ? `${needsYou} thing${needsYou === 1 ? "" : "s"} need${needsYou === 1 ? "s" : ""} you.` : "Nothing needs you right now.",
    section("Approvals waiting", approvals.map((a) => `- ${name(a.agentId)}: ${a.action}`)),
    section("Waiting on you", waiting.map((t) => `- ${t.title} (${name(t.ownerAgentId)})`)),
    section("Ready for your review", review.slice(0, 15).map((t) => `- ${t.title} (${name(t.ownerAgentId)})`)),
    section("Finished in the last day", finished.slice(0, 20).map((t) => `- ${t.title} (${name(t.ownerAgentId)})`), "- nothing"),
    section("In progress", working.slice(0, 15).map((t) => `- ${t.title} (${name(t.ownerAgentId)}, ${t.progressPct}%)`), "- nothing"),
    problems.length ? `Problems in the last day: ${problems.length}. See the Audit log.` : null,
    section("Scheduled for the next day", today.map((s) => `- ${s.title} (${describeTiming(s).toLowerCase()})`)),
    `Spent in the last day: ${usd(daySpend.total)}. This month: ${usd(month.spent.total)}${month.cap ? ` of ${usd(month.cap)}` : ""}.`,
    boardLink("/"),
  ]
    .filter(Boolean)
    .join("\n\n");
  const subject = `[AgentsHUB] Daily digest: ${finished.length} done${needsYou ? `, ${needsYou} need you` : ""}`;
  return { subject, text, needsYou };
}
