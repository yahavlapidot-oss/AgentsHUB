import { ok, parseBody, withAgent, z } from "@/lib/api";
import { getInbox, postMessage } from "@/lib/data";

/** Messages for this agent (direct or broadcast) newer than `?since=<ms>`. */
export const GET = withAgent(async (req, agent) => {
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0) || 0;
  const messages = await getInbox(agent.id, since);
  return ok({ messages });
});

const Body = z.object({
  text: z.string().min(1).max(10_000),
  toAgentId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
});

/** Post to the team chat. Omit toAgentId to talk to everyone. */
export const POST = withAgent(async (req, agent) => {
  const body = await parseBody(req, Body);
  const message = await postMessage({ ...body, fromAgentId: agent.id });
  return ok({ message }, 201);
});
