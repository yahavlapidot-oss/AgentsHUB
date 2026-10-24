import { ok, withAgent } from "@/lib/api";
import { takePendingCommands } from "@/lib/data";

/** Pending commands from the user. Each is returned once, then marked delivered. */
export const GET = withAgent(async (_req, agent) => {
  return ok({ commands: await takePendingCommands(agent.id) });
});
