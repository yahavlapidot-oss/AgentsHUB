/**
 * The gate every agent action passes through before it runs: Claude Code's
 * PreToolUse hook, MCP clients (via /api/v1/policy/check) and hosted agents all
 * call `gateAction`. It answers allow, ask (wait for the user), deny or paused.
 */
import {
  approvalTooOld,
  consumeApproval,
  expireApproval,
  expireApprovals,
  findOpenApproval,
  getAgent,
  getEmergencyStop,
  requestApproval,
} from "./data";
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
  input: {
    action: string;
    taskId?: string | null;
    reason?: string;
    /** Where it happens and what goes out, shown to you on the Approvals page. */
    service?: string;
    details?: string;
    force?: boolean;
    ignore?: PolicyCategory[];
    /** Ask even for an action the policy allows when the agent is set to "cautious". */
    askIfCautious?: boolean;
  },
): Promise<GateResult> {
  const agent = await getAgent(agentId);
  // `ignore` drops rules that don't apply where the action runs, e.g. deleting files inside a throwaway sandbox.
  const policy = evaluatePolicy(input.action, { ignore: input.ignore });
  const base = { categories: policy.categories, reasons: policy.reasons };
  // The emergency stop holds every agent, whatever it was about to do.
  if (agent?.status === "paused" || (await getEmergencyStop())) return { decision: "paused", ...base };
  const cautious = Boolean(input.askIfCautious && agent?.autonomy === "cautious");
  if (!policy.requiresApproval && !input.force && !cautious) return { decision: "allow", ...base };

  await expireApprovals();
  const action = input.action.slice(0, 500);
  let open = await findOpenApproval(agentId, action);
  if (open && approvalTooOld(open)) {
    // Your OK was for then; after this long the agent has to ask again.
    await expireApproval(open.id);
    open = null;
  }
  if (open?.decision === "approved") {
    await consumeApproval(open.id);
    return { decision: "allow", ...base, approval: open };
  }
  if (open?.decision === "denied" || open?.decision === "expired") {
    await consumeApproval(open.id);
    const reasons = open.decision === "expired" ? ["nobody decided in time, so the request expired"] : base.reasons;
    return { decision: "deny", categories: base.categories, reasons, approval: open };
  }
  if (open) return { decision: "ask", ...base, approval: open };

  const why = policy.reasons.length ? policy.reasons.join(", ") : cautious ? "this agent is set to ask before every command" : "the agent asked";
  const approval = await requestApproval(agentId, {
    taskId: input.taskId ?? agent?.currentTaskId ?? null,
    action,
    reason: input.reason || `Needs your OK: ${why}`,
    service: input.service || policy.services.join(", "),
    details: input.details,
    risk: (input.force || cautious) && !policy.categories.length ? "medium" : riskFor(policy.categories),
  });
  return { decision: "ask", ...base, approval };
}
