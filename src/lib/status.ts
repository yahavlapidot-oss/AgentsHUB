/**
 * The Status page and the health check: is the database answering, is the
 * runner going round, do the file bucket, email and cloud computers work, and
 * what went wrong lately.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { getApprovals, getEmergencyStop, getOpenSandboxes } from "./data";
import { recentProblems, runnerHealth, type Problem, type RunnerHealth } from "./monitor";
import { sandboxesAvailable } from "./sandbox/provider";
import { events } from "./schema";
import { checkBlobStore } from "./storage";

/** The bucket check writes a small file, so it runs at most this often. */
const BUCKET_CHECK_EVERY_MS = 5 * 60_000;
let bucketCheck: { at: number; check: Check } | null = null;

async function checkBucket(now: number): Promise<Check> {
  if (bucketCheck && now - bucketCheck.at < BUCKET_CHECK_EVERY_MS) return bucketCheck.check;
  let check: Check;
  try {
    const r = await checkBlobStore();
    check = { name: "File bucket", state: r === "ok" ? "ok" : "off", detail: r === "ok" ? "writes and reads back" : "not set up; files are kept in the database" };
  } catch (e) {
    check = { name: "File bucket", state: "problem", detail: `${(e as Error).message}; new files fall back to the database` };
  }
  bucketCheck = { at: now, check };
  return check;
}

export type Check = { name: string; state: "ok" | "off" | "problem"; detail: string };

/** Answers in a few milliseconds; used by /api/health, which the host calls often. */
export async function checkDatabase(): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = performance.now();
  try {
    await db.run(sql`select 1`);
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), error: (e as Error).message };
  }
}

export async function getSystemStatus(now = Date.now()): Promise<{
  checks: Check[];
  runner: RunnerHealth;
  agentErrors24h: number;
  problems: Problem[];
  version: string | null;
}> {
  const database = await checkDatabase();
  const runner = runnerHealth(now);
  const checks: Check[] = [
    { name: "Database", state: database.ok ? "ok" : "problem", detail: database.ok ? `answers in ${database.ms} ms` : database.error! },
    {
      name: "Agent runner",
      state: runner.state === "stuck" ? "problem" : runner.state === "off" ? "off" : "ok",
      detail:
        runner.state === "off"
          ? "off on this server (RUNNER_ENABLED=0)"
          : runner.state === "stuck"
            ? `no round finished since ${runner.lastTickAt ? new Date(runner.lastTickAt).toISOString() : "it started"}`
            : runner.lastError
              ? `running; last round failed: ${runner.lastError}`
              : "running",
    },
  ];

  checks.push(await checkBucket(now));

  const email = Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL);
  checks.push({ name: "Email alerts", state: email ? "ok" : "off", detail: email ? `to ${process.env.NOTIFY_EMAIL}` : "set RESEND_API_KEY and NOTIFY_EMAIL" });

  const [computers, open, stop, pending] = await Promise.all([
    sandboxesAvailable().catch(() => false),
    database.ok ? getOpenSandboxes() : [],
    database.ok ? getEmergencyStop() : null,
    database.ok ? getApprovals({ pendingOnly: true }) : [],
  ]);
  checks.push({ name: "Cloud computers", state: computers ? "ok" : "off", detail: computers ? `${open.length} running now` : "not set up (E2B_API_KEY)" });
  checks.push({ name: "Emergency stop", state: stop ? "problem" : "ok", detail: stop ? "on: no agent works until you resume" : "off" });
  checks.push({ name: "Approvals", state: "ok", detail: `${pending.length} waiting for you` });

  const [errors] = database.ok
    ? await db.select({ n: sql<number>`count(*)` }).from(events).where(and(eq(events.type, "error"), gte(events.at, now - 24 * 3_600_000)))
    : [{ n: 0 }];

  return {
    checks,
    runner,
    agentErrors24h: Number(errors?.n ?? 0),
    problems: recentProblems(),
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  };
}
