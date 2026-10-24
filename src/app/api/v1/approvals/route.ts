import { ok, parseBody, withAgent, z } from "@/lib/api";
import { requestApproval } from "@/lib/data";
import { RISKS } from "@/lib/schema";

const Body = z.object({
  action: z.string().min(1).max(500),
  reason: z.string().max(5_000).optional(),
  risk: z.enum(RISKS).optional(),
  taskId: z.string().nullable().optional(),
});

/** Ask the user before a risky step, then poll GET /approvals/:id for the decision. */
export const POST = withAgent(async (req, agent) => {
  const body = await parseBody(req, Body);
  const approval = await requestApproval(agent.id, body);
  return ok({ approval }, 201);
});
