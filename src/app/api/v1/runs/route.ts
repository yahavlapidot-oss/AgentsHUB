import { ok, parseBody, withAgent, z } from "@/lib/api";
import { startRun } from "@/lib/data";

const Body = z.object({ model: z.string().min(1), taskId: z.string().nullable().optional() });

/** Start a run (one working session on a task). Report usage to /runs/:id as you go. */
export const POST = withAgent(async (req, agent) => {
  const body = await parseBody(req, Body);
  const run = await startRun(agent.id, body);
  return ok({ run }, 201);
});
