import { ok, parseBody, withAgent, z } from "@/lib/api";
import { createTask, getTasks } from "@/lib/data";
import { COLUMNS, PRIORITIES } from "@/lib/schema";

/** Lists tasks. `?mine=1` for tasks owned by this agent, `?column=ready` to filter. */
export const GET = withAgent(async (req, agent) => {
  const url = new URL(req.url);
  const column = url.searchParams.get("column");
  const mine = url.searchParams.get("mine") === "1";
  const all = await getTasks();
  const tasks = all.filter(
    (t) => (!mine || t.ownerAgentId === agent.id) && (!column || t.column === column),
  );
  return ok({ tasks });
});

const Body = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(10_000).optional(),
  column: z.enum(COLUMNS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ownerAgentId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  dependsOn: z.array(z.string()).optional(),
  acceptanceCriteria: z.string().max(5_000).optional(),
});

/** Agents can split work into new tasks (for themselves or other agents). */
export const POST = withAgent(async (req, agent) => {
  const body = await parseBody(req, Body);
  const task = await createTask({ ...body, createdBy: agent.id });
  return ok({ task }, 201);
});
