/**
 * The gate every agent action passes through before it runs: Claude Code's
 * PreToolUse hook, MCP clients (via /api/v1/policy/check) and hosted agents all
 * call `gateAction`. It answers allow, ask (wait for the user), deny or paused.
 */
import { consumeApproval, findOpenApproval, getAgent, requestApproval } from "./data";
import { evaluatePolicy, riskFor, type PolicyCategory } from "./policy";
import type { Approval } from "./schema";

export type GateResult =
  | { decision: "allow"; categories: PolicyCategory[]; reasons: string[]; approval?: Approval }
  | { decision: "ask"; categories: PolicyCategory[]; reasons: string[]; approval: Approval }
  | { decision: "deny"; categories: PolicyCategory[]; reasons: string[]; approval: Approval }
  | { decision: "paused"; categories: PolicyCategory[]; reasons: string[] };

/**
 * `action` is a one-line description of what the agent is about to do, for
 * example `Bash: git push origin main`. The same text is shown to the user on the
 * Approvals page, and an approval covers exactly that text, once.
 */
export async function gateAction(
  agentId: string,
  input: { action: string; taskId?: string | null; reason?: string; force?: boolean },
): Promise<GateResult> {
  const agent = await getAgent(agentId);
  const policy = evaluatePolicy(input.action);
  const base = { categories: policy.categories, reasons: policy.reasons };
  if (agent?.status === "paused") return { decision: "paused", ...base };
  if (!policy.requiresApproval && !input.force) return { decision: "allow", ...base };

  const action = input.action.slice(0, 500);
  const open = await findOpenApproval(agentId, action);
  if (open?.decision === "approved") {
    await consumeApproval(open.id);
    return { decision: "allow", ...base, approval: open };
  }
  if (open?.decision === "denied") {
    await consumeApproval(open.id);
    return { decision: "deny", ...base, approval: open };
  }
  if (open) return { decision: "ask", ...base, approval: open };

  const approval = await requestApproval(agentId, {
    taskId: input.taskId ?? agent?.currentTaskId ?? null,
    action,
    reason: input.reason || `Needs your OK: ${policy.reasons.join(", ") || "the agent asked"}`,
    risk: input.force && !policy.categories.length ? "medium" : riskFor(policy.categories),
  });
  return { decision: "ask", ...base, approval };
}

