import { ok, withAgent } from "@/lib/api";
import { completeCommand } from "@/lib/data";

export const POST = withAgent<{ id: string }>(async (_req, agent, { id }) => {
  await completeCommand(agent.id, id);
  return ok({ ok: true });
});
