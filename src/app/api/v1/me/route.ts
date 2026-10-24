import { ok, withAgent } from "@/lib/api";

/** Lets an agent check its token and see how the hub knows it. */
export const GET = withAgent(async (_req, agent) => {
  const { tokenHash: _hidden, ...me } = agent;
  return ok({ agent: me });
});
