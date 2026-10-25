/**
 * Housekeeping the server does on its own, checked on every runner tick: each
 * job remembers in settings when it last ran, so a restart doesn't repeat it.
 */
import { getSetting, setSetting } from "./data";

type Job = { key: string; due: (lastRun: number | null, now: number) => boolean; run: () => Promise<void> };

const JOBS: Job[] = [];

/** Adds a job (modules call this when they load). */
export function registerJob(job: Job): void {
  if (!JOBS.some((j) => j.key === job.key)) JOBS.push(job);
}

let running = false;

export async function runHousekeeping(now = Date.now()): Promise<string[]> {
  if (running) return [];
  running = true;
  const ran: string[] = [];
  try {
    for (const job of JOBS) {
      const last = await getSetting<number>(`job:${job.key}`);
      if (!job.due(last, now)) continue;
      // Mark first: a job that crashes waits for its next turn instead of retrying every tick.
      await setSetting(`job:${job.key}`, now);
      try {
        await job.run();
        ran.push(job.key);
      } catch (e) {
        console.error(`[jobs] ${job.key} failed`, e);
      }
    }
  } finally {
    running = false;
  }
  return ran;
}
