import { ok, parseBody, withAgent, z } from "@/lib/api";
import { addEvent } from "@/lib/data";
import { EVENT_TYPES } from "@/lib/schema";

const Body = z.object({
  type: z.enum(EVENT_TYPES),
  taskId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  payload: z.record(z.unknown()).optional(),
});

/** Activity log: tool calls, file edits, notes, errors. */
export const POST = withAgent(async (req, agent) => {
  const body = await parseBody(req, Body);
  const event = await addEvent({ ...body, agentId: agent.id });
  return ok({ event }, 201);
});
