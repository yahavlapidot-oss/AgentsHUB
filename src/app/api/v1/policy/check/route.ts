import { ok, parseBody, withAgent, z } from "@/lib/api";
import { gateAction } from "@/lib/control";
import { describeToolCall } from "@/lib/policy";

const Body = z
  .object({
    action: z.string().min(1).max(2_000).optional(),
    tool: z.string().min(1).max(200).optional(),
    input: z.unknown().optional(),
    taskId: z.string().nullable().optional(),
    reason: z.string().max(2_000).optional(),
  })
  .refine((b) => b.action || b.tool, { message: "Send `action`, or `tool` with its `input`" });

/**
 * Ask before acting. Returns `decision`: "allow" (go ahead), "ask" (an approval
 * was opened; poll GET /approvals/:id and call this again once it's decided),
 * "deny" (the user said no) or "paused" (wait for a resume command).
 */
export const POST = withAgent(async (req, agent) => {
  const body = await parseBody(req, Body);
  const action = body.action ?? describeToolCall(body.tool!, body.input);
  const result = await gateAction(agent.id, { action, taskId: body.taskId, reason: body.reason });
  return ok({ ...result, action });
});
