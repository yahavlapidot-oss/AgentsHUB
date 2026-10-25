import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-mon-")), "test.db")}`;

let monitor: typeof import("../src/lib/monitor");
let status: typeof import("../src/lib/status");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  monitor = await import("../src/lib/monitor");
  status = await import("../src/lib/status");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  monitor._resetMonitor();
});

describe("monitoring", () => {
  it("keeps problems and emails once per kind per half hour", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NOTIFY_EMAIL", "me@example.com");
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = Date.now();
    await monitor.recordProblem("runner", new Error("database is locked"), t);
    await monitor.recordProblem("runner", new Error("database is locked"), t + 60_000);
    await monitor.recordProblem("storage", new Error("bucket 403"), t + 60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await monitor.recordProblem("runner", new Error("again"), t + monitor.ALERT_EVERY_MS + 1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(monitor.recentProblems().map((p) => p.message)).toEqual(["again", "bucket 403", "database is locked", "database is locked"]);
  });

  it("calls a runner stuck when no round finished for two minutes", () => {
    const t = Date.now();
    expect(monitor.runnerHealth(t).state).toBe("off");
    monitor.runnerStarted(t);
    expect(monitor.runnerHealth(t + 1000).state).toBe("starting");
    monitor.runnerTicked(null, t + 10_000);
    expect(monitor.runnerHealth(t + 20_000).state).toBe("ok");
    expect(monitor.runnerHealth(t + 10_000 + monitor.RUNNER_STALE_MS + 1).state).toBe("stuck");
    vi.stubEnv("RUNNER_ENABLED", "0");
    expect(monitor.runnerHealth(t).state).toBe("off");
  });

  it("reports the system's state", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const s = await status.getSystemStatus();
    const byName = Object.fromEntries(s.checks.map((c) => [c.name, c.state]));
    expect(byName).toMatchObject({ Database: "ok", "Email alerts": "off", "Emergency stop": "ok", "File bucket": "off" });
    expect((await status.checkDatabase()).ok).toBe(true);
  });
});
