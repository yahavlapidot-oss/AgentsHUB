/**
 * Recurring tasks. Each schedule says when (every N minutes, hourly, daily,
 * weekly on some days, monthly) in a time zone, and what task to add. The
 * runner calls runDueSchedules on every tick; a due schedule adds its task to
 * Ready and moves on to its next time. Missed times while the server was down
 * or the emergency stop was on fire once, not once per missed time.
 */
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "./db";
import { addEvent, createTask, getTask } from "./data";
import { newId } from "./ids";
import { PRIORITIES, SCHEDULE_FREQUENCIES, schedules, type Schedule } from "./schema";
import { z } from "zod";

export const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Jerusalem";
export const MIN_INTERVAL_MINUTES = 15;

export const ScheduleInput = z
  .object({
    title: z.string().trim().min(1, "Give it a title").max(300),
    description: z.string().max(10_000).default(""),
    acceptanceCriteria: z.string().max(5_000).default(""),
    priority: z.enum(PRIORITIES).default("medium"),
    projectId: z.string().nullable().default(null),
    ownerAgentId: z.string().nullable().default(null),
    frequency: z.enum(SCHEDULE_FREQUENCIES).default("daily"),
    intervalMinutes: z.number().int().min(MIN_INTERVAL_MINUTES, `At least every ${MIN_INTERVAL_MINUTES} minutes`).max(7 * 24 * 60).nullable().default(null),
    timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time as HH:MM").default("08:00"),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    dayOfMonth: z.number().int().min(1).max(28).nullable().default(null),
    timezone: z.string().refine(validTimezone, "Unknown time zone").default(DEFAULT_TIMEZONE),
    enabled: z.boolean().default(true),
    skipIfOpen: z.boolean().default(true),
  })
  .refine((s) => s.frequency !== "minutes" || s.intervalMinutes, { message: "Say how many minutes between runs", path: ["intervalMinutes"] })
  .refine((s) => s.frequency !== "weekly" || s.weekdays.length > 0, { message: "Pick at least one day", path: ["weekdays"] });

export type ScheduleFields = z.output<typeof ScheduleInput>;
type Timing = Pick<Schedule, "frequency" | "intervalMinutes" | "timeOfDay" | "weekdays" | "dayOfMonth" | "timezone">;

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock parts of an instant in a time zone. */
function zonedParts(ms: number, tz: string): { y: number; m: number; d: number; hh: number; mm: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: Number(parts.hour),
    mm: Number(parts.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday),
  };
}

/** The instant a wall-clock time in a time zone happens (the later one if a clock change skips it). */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const diff = wall - shown;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/** The first due time strictly after `after`. */
export function nextRunAfter(s: Timing, after: number): number {
  if (s.frequency === "minutes") {
    const step = Math.max(s.intervalMinutes ?? 60, MIN_INTERVAL_MINUTES) * 60_000;
    return Math.floor(after / 60_000) * 60_000 + step;
  }
  const [hh, mm] = s.timeOfDay.split(":").map(Number);
  if (s.frequency === "hourly") {
    const p = zonedParts(after, s.timezone);
    let at = zonedTimeToUtc(p.y, p.m, p.d, p.hh, mm, s.timezone);
    while (at <= after) at += 60 * 60_000;
    return at;
  }
  const start = zonedParts(after, s.timezone);
  // Walk forward day by day (in the zone's calendar) until one matches.
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const weekday = day.getUTCDay();
    if (s.frequency === "weekly" && !s.weekdays.includes(weekday)) continue;
    if (s.frequency === "monthly" && d !== (s.dayOfMonth ?? 1)) continue;
    const at = zonedTimeToUtc(y, m, d, hh, mm, s.timezone);
    if (at > after) return at;
  }
  throw new Error("No next run within a year");
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Every day at 08:00", "Mon, Thu at 09:30", "Every 30 minutes". */
export function describeTiming(s: Timing): string {
  switch (s.frequency) {
    case "minutes":
      return `Every ${s.intervalMinutes} minutes`;
    case "hourly":
      return `Every hour at :${s.timeOfDay.split(":")[1]}`;
    case "daily":
      return `Every day at ${s.timeOfDay}`;
    case "weekly":
      return `${[...s.weekdays].sort().map((d) => DAY_NAMES[d]).join(", ")} at ${s.timeOfDay}`;
    case "monthly":
      return `Monthly on day ${s.dayOfMonth ?? 1} at ${s.timeOfDay}`;
  }
}

export async function getSchedules(): Promise<Schedule[]> {
  return db.select().from(schedules).orderBy(asc(schedules.nextRunAt));
}

export async function getSchedule(id: string): Promise<Schedule | null> {
  const [row] = await db.select().from(schedules).where(eq(schedules.id, id));
  return row ?? null;
}

export async function createSchedule(input: z.input<typeof ScheduleInput>, createdBy = "user"): Promise<Schedule> {
  const fields = ScheduleInput.parse(input);
  const now = Date.now();
  const [row] = await db
    .insert(schedules)
    .values({ id: newId("sched"), ...fields, nextRunAt: fields.enabled ? nextRunAfter(fields, now) : null, createdBy, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

export async function updateSchedule(id: string, input: z.input<typeof ScheduleInput>): Promise<Schedule | null> {
  const fields = ScheduleInput.parse(input);
  const now = Date.now();
  const [row] = await db
    .update(schedules)
    .set({ ...fields, nextRunAt: fields.enabled ? nextRunAfter(fields, now) : null, updatedAt: now })
    .where(eq(schedules.id, id))
    .returning();
  return row ?? null;
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  const s = await getSchedule(id);
  if (!s) return;
  await db
    .update(schedules)
    .set({ enabled, nextRunAt: enabled ? nextRunAfter(s, Date.now()) : null, updatedAt: Date.now() })
    .where(eq(schedules.id, id));
}

export async function deleteSchedule(id: string): Promise<void> {
  await db.delete(schedules).where(eq(schedules.id, id));
}

/** Adds the schedule's task now. `manual` runs even while the last task is open. */
export async function fireSchedule(s: Schedule, now = Date.now(), opts: { manual?: boolean } = {}): Promise<{ taskId: string | null; skipped?: string }> {
  const next = s.enabled ? nextRunAfter(s, now) : null;
  if (!opts.manual && s.skipIfOpen && s.lastTaskId) {
    const last = await getTask(s.lastTaskId);
    if (last && last.column !== "done" && last.column !== "review") {
      await db.update(schedules).set({ nextRunAt: next, updatedAt: now }).where(eq(schedules.id, s.id));
      return { taskId: null, skipped: `the last one ("${last.title}") is still open` };
    }
  }
  const task = await createTask({
    title: s.title,
    description: [s.description, `(Recurring: ${describeTiming(s).toLowerCase()}, ${s.timezone})`].filter(Boolean).join("\n\n"),
    acceptanceCriteria: s.acceptanceCriteria,
    priority: s.priority,
    projectId: s.projectId,
    ownerAgentId: s.ownerAgentId,
    column: "ready",
    createdBy: `schedule:${s.id}`,
  });
  await db
    .update(schedules)
    .set({ lastRunAt: now, lastTaskId: task.id, runCount: s.runCount + 1, nextRunAt: next, updatedAt: now })
    .where(eq(schedules.id, s.id));
  await addEvent({ agentId: null, taskId: task.id, type: "status_change", payload: { text: `Added by the schedule "${s.title}"` } });
  return { taskId: task.id };
}

/** Fires every enabled schedule whose time has come. Returns how many tasks were added. */
export async function runDueSchedules(now = Date.now()): Promise<number> {
  const due = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)));
  let added = 0;
  for (const s of due) {
    try {
      if ((await fireSchedule(s, now)).taskId) added++;
    } catch (e) {
      console.error(`[schedules] ${s.id} failed`, e);
      // Don't retry every tick: move on to the next time.
      await db.update(schedules).set({ nextRunAt: nextRunAfter(s, now) }).where(eq(schedules.id, s.id));
    }
  }
  return added;
}
