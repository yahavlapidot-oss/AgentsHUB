import { error, ok, parseBody, withAgent, z } from "@/lib/api";
import { addUsage, endRun, getRun } from "@/lib/data";

const Body = z.object({
  tokensIn: z.number().int().min(0).default(0),
  tokensOut: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).optional(),
  outcome: z.enum(["success", "failed", "cancelled"]).optional(),
});

/** Adds token usage to the run; send `outcome` to close it. */
export const PATCH = withAgent<{ id: string }>(async (req, agent, { id }) => {
  const run = await getRun(id);
  if (!run || run.agentId !== agent.id) return error(404, "Run not found");
  const body = await parseBody(req, Body);
  if (body.tokensIn || body.tokensOut || body.costUsd) await addUsage(agent.id, id, body);
  if (body.outcome) await endRun(agent.id, id, body.outcome);
  return ok({ run: await getRun(id) });
});
