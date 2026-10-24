import { error, ok, withAgent } from "@/lib/api";
import { getApproval } from "@/lib/data";

export const GET = withAgent<{ id: string }>(async (_req, agent, { id }) => {
  const approval = await getApproval(id);
  if (!approval || approval.agentId !== agent.id) return error(404, "Approval not found");
  return ok({ approval });
});
