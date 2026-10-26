import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-sched-")), "test.db")}`;

let s: typeof import("../src/lib/schedules");
let data: typeof import("../src/lib/data");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  s = await import("../src/lib/schedules");
  data = await import("../src/lib/data");
});

const base = { intervalMinutes: null, weekdays: [] as number[], dayOfMonth: null, timezone: "Asia/Jerusalem" };

describe("next run times", () => {
  it("daily at a wall-clock time in the zone", () => {
    // 2026-10-25 23:00 UTC is 01:00 on the 26th in Jerusalem (winter time, UTC+2).
    const after = Date.UTC(2026, 9, 25, 23, 0);
    const next = s.nextRunAfter({ ...base, frequency: "daily", timeOfDay: "08:00" }, after);
    expect(new Date(next).toISOString()).toBe("2026-10-26T06:00:00.000Z");
  });

  it("keeps the wall-clock time across daylight saving", () => {
    // Israel moves to summer time on Friday 2027-03-26; 08:00 is then 05:00 UTC.
    const after = Date.UTC(2027, 2, 25, 7, 0);
    const next = s.nextRunAfter({ ...base, frequency: "daily", timeOfDay: "08:00" }, after);
    expect(new Date(next).toISOString()).toBe("2027-03-26T05:00:00.000Z");
  });

  it("weekly on chosen days, monthly, hourly and every N minutes", () => {
    const sunday = Date.UTC(2026, 9, 25, 10, 0); // Sunday 12:00 in Jerusalem
    const weekly = s.nextRunAfter({ ...base, frequency: "weekly", timeOfDay: "09:00", weekdays: [2, 4] }, sunday);
    expect(new Date(weekly).toISOString()).toBe("2026-10-27T07:00:00.000Z"); // Tuesday
    const monthly = s.nextRunAfter({ ...base, frequency: "monthly", timeOfDay: "10:00", dayOfMonth: 1 }, sunday);
    expect(new Date(monthly).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    const hourly = s.nextRunAfter({ ...base, frequency: "hourly", timeOfDay: "00:15" }, sunday);
    expect(new Date(hourly).toISOString()).toBe("2026-10-25T10:15:00.000Z");
    expect(s.nextRunAfter({ ...base, frequency: "minutes", intervalMinutes: 30, timeOfDay: "00:00" }, sunday)).toBe(sunday + 30 * 60_000);
  });

  it("describes the timing", () => {
    expect(s.describeTiming({ ...base, frequency: "weekly", timeOfDay: "09:00", weekdays: [4, 0] })).toBe("Sun, Thu at 09:00");
  });
});

describe("running schedules", () => {
  it("adds a task when due and skips while the last one is open", async () => {
    const sched = await s.createSchedule({ title: "Morning summary", description: "News", frequency: "daily", timeOfDay: "08:00" });
    expect(sched.nextRunAt).toBeGreaterThan(Date.now());
    expect(await s.runDueSchedules(Date.now())).toBe(0);

    const later = sched.nextRunAt! + 1000;
    expect(await s.runDueSchedules(later)).toBe(1);
    const after = (await s.getSchedule(sched.id))!;
    const task = (await data.getTask(after.lastTaskId!))!;
    expect(task.title).toBe("Morning summary");
    expect(task.column).toBe("ready");
    expect(task.createdBy).toBe(`schedule:${sched.id}`);
    expect(after.nextRunAt).toBeGreaterThan(later);

    // The task is still open, so the next time adds nothing.
    expect(await s.runDueSchedules(after.nextRunAt! + 1000)).toBe(0);
    await data.updateTask(task.id, { column: "done" });
    const again = (await s.getSchedule(sched.id))!;
    expect(await s.runDueSchedules(again.nextRunAt! + 1000)).toBe(1);
  });

  it("rejects bad input", async () => {
    await expect(s.createSchedule({ title: "x", frequency: "minutes", intervalMinutes: 5 })).rejects.toThrow(/15 minutes/);
    await expect(s.createSchedule({ title: "x", frequency: "weekly", weekdays: [] })).rejects.toThrow(/day/);
    await expect(s.createSchedule({ title: "x", timezone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
  });
});
