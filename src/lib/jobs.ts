/**
 * Housekeeping the server does on its own, checked on every runner tick: each
 * job remembers in settings when it last ran, so a restart doesn't repeat it.
 */
import { getSetting, setSetting } from "./data";
import { buildDigest, digestDue, getDigestSettings } from "./digest";
import { notify } from "./notify";

type Job = { key: string; due: (lastRun: number | null, now: number) => Promise<boolean>; run: () => Promise<void> };

const JOBS: Job[] = [
  {
    key: "digest",
    due: async (last, now) => digestDue(await getDigestSettings(), last, now),
    run: async () => {
      const d = await buildDigest();
      await notify(d.subject, d.text, { kind: "digest" });
    },
  },
];

let running = false;

export async function runHousekeeping(now = Date.now()): Promise<string[]> {
  if (running) return [];
  running = true;
  const ran: string[] = [];
  try {
    for (const job of JOBS) {
      const last = await getSetting<number>(`job:${job.key}`);
      if (!(await job.due(last, now))) continue;
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
