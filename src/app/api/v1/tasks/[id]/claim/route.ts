import { error, ok, withAgent } from "@/lib/api";
import { claimTask } from "@/lib/data";

export const POST = withAgent<{ id: string }>(async (_req, agent, { id }) => {
  const task = await claimTask(agent.id, id);
  return task ? ok({ task }) : error(404, "Task not found");
});
