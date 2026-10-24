import { error, ok, parseBody, withAgent, z } from "@/lib/api";
import { reportProgress } from "@/lib/data";
import { COLUMNS } from "@/lib/schema";

const Body = z.object({
  progressPct: z.number().min(0).max(100).optional(),
  note: z.string().max(5_000).optional(),
  column: z.enum(COLUMNS).optional(),
});

export const POST = withAgent<{ id: string }>(async (req, agent, { id }) => {
  const body = await parseBody(req, Body);
  const task = await reportProgress(agent.id, id, body);
  return task ? ok({ task }) : error(404, "Task not found");
});
