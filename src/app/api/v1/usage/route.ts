import { ok, parseBody, withAgent, z } from "@/lib/api";
import { recordUsage } from "@/lib/data";

const Body = z.object({
  model: z.string().min(1),
  taskId: z.string().nullable().optional(),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  costUsd: z.number().min(0).optional(),
});

/** Simplest way to report usage: one call per model response. */
export const POST = withAgent(async (req, agent) => {
  const body = await parseBody(req, Body);
  const run = await recordUsage(agent.id, body);
  return ok({ run }, 201);
});
