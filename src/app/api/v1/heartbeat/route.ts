import { ok, parseBody, withAgent, z } from "@/lib/api";
import { heartbeat, takePendingCommands } from "@/lib/data";

const Body = z.object({
  status: z.enum(["active", "waiting"]).optional(),
  currentTaskId: z.string().nullable().optional(),
  model: z.string().min(1).optional(),
});

/** Call every minute or so. Returns any commands the user sent (pause, redirect...). */
export const POST = withAgent(async (req, agent) => {
  const body = await parseBody(req, Body);
  await heartbeat(agent.id, body);
  const commands = await takePendingCommands(agent.id);
  return ok({ ok: true, commands });
});
