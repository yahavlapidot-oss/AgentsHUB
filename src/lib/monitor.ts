/**
 * Keeps an eye on the server: problems are logged, kept in memory for the
 * Status page, and emailed (at most once per ALERT_EVERY_MS for each kind),
 * so a stuck runner or a failing database doesn't go unnoticed.
 */
import { boardLink, notifyByEmail } from "./notify";

export const ALERT_EVERY_MS = Number(process.env.ALERT_EVERY_MS ?? 30 * 60_000);
const KEEP = 50;

export type Problem = { at: number; source: string; message: string };

const state = globalThis as unknown as {
  agentshubProblems?: Problem[];
  agentshubAlerted?: Map<string, number>;
  agentshubRunnerBeat?: { startedAt: number; lastTickAt: number | null; lastError: string | null };
};
const problems = (state.agentshubProblems ??= []);
const alerted = (state.agentshubAlerted ??= new Map());

/** Something went wrong outside an agent's own task (those go on the task). */
export async function recordProblem(source: string, err: unknown, now = Date.now()): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${source}]`, err);
  problems.unshift({ at: now, source, message: message.slice(0, 1_000) });
  problems.length = Math.min(problems.length, KEEP);
  const last = alerted.get(source) ?? 0;
  if (now - last < ALERT_EVERY_MS) return;
  alerted.set(source, now);
  await notifyByEmail(`[AgentsHUB] Server problem: ${source}`, `${message.slice(0, 2_000)}\n\nMore on the status page: ${boardLink("/status")}`);
}

export function recentProblems(): Problem[] {
  return [...problems];
}

// ---------------------------------------------------------------- runner heartbeat

export function runnerStarted(now = Date.now()): void {
  state.agentshubRunnerBeat = { startedAt: now, lastTickAt: null, lastError: null };
}

export function runnerTicked(error: string | null = null, now = Date.now()): void {
  const beat = (state.agentshubRunnerBeat ??= { startedAt: now, lastTickAt: null, lastError: null });
  beat.lastTickAt = now;
  beat.lastError = error;
}

/** A runner that hasn't finished a round for this long is stuck. */
export const RUNNER_STALE_MS = 2 * 60_000;

export type RunnerHealth = { state: "off" | "ok" | "starting" | "stuck"; lastTickAt: number | null; lastError: string | null };

export function runnerHealth(now = Date.now()): RunnerHealth {
  if (process.env.RUNNER_ENABLED === "0") return { state: "off", lastTickAt: null, lastError: null };
  const beat = state.agentshubRunnerBeat;
  if (!beat) return { state: "off", lastTickAt: null, lastError: null };
  const since = beat.lastTickAt ?? beat.startedAt;
  if (now - since > RUNNER_STALE_MS) return { state: "stuck", lastTickAt: beat.lastTickAt, lastError: beat.lastError };
  return { state: beat.lastTickAt ? "ok" : "starting", lastTickAt: beat.lastTickAt, lastError: beat.lastError };
}

/** Test hook. */
export function _resetMonitor(): void {
  problems.length = 0;
  alerted.clear();
  delete state.agentshubRunnerBeat;
}
