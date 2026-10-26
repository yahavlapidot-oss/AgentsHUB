/**
 * The approval step for tools that reach outside AgentsHUB (send an email, open
 * a PR, redeploy). Every call goes through the same gate as shell commands;
 * sending always asks once the run has read untrusted content (a web page, an
 * email, an issue), since that content may be trying to steer the agent.
 */
import type { ToolContext } from "../agent-tools";
import { gateAction, type GateResult } from "../control";

export type Asked = { ok: true } | { ok: false; refused: { done: false; decision: GateResult["decision"]; reason: string } };

export async function askFirst(
  ctx: ToolContext,
  input: { action: string; service: string; details?: string; reason?: string; alwaysAsk?: boolean },
): Promise<Asked> {
  const tainted = Boolean(ctx.taint?.tainted);
  const gate = await gateAction(ctx.agent.id, {
    action: input.action,
    taskId: ctx.taskId,
    service: input.service,
    details: input.details,
    reason: input.reason ?? (tainted && !input.alwaysAsk ? `Needs your OK: this run read outside content (${ctx.taint!.sources.join(", ")}) before asking to do this` : undefined),
    force: input.alwaysAsk || tainted,
    askIfCautious: true,
  });
  const result = gate.decision === "ask" && ctx.waitForApproval ? await ctx.waitForApproval(gate) : gate;
  if (result.decision === "allow") return { ok: true };
  return {
    ok: false,
    refused: {
      done: false,
      decision: result.decision,
      reason:
        result.decision === "ask"
          ? "Waiting for the user's approval. Call this tool again with the same input to check."
          : result.reasons.join(", ") || "The user didn't approve this",
    },
  };
}
