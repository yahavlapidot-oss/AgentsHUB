"use client";

import { useRouter } from "next/navigation";
import { decideApprovalAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";
import type { Approval } from "@/lib/schema";
import { useLive } from "./live";
import { AgentAvatar, EmptyState } from "./ui";

const RISK = { low: "#00c875", medium: "#fdab3d", high: "#e2445c" } as const;

const DECISION_STYLE: Record<Exclude<Approval["decision"], "pending">, string> = {
  approved: "bg-[#00c875]",
  denied: "bg-[#e2445c]",
  expired: "bg-[#9699a6]",
};

function timeUntil(at: number): string {
  const min = Math.max(0, Math.round((at - Date.now()) / 60_000));
  return min >= 120 ? `in ${Math.round(min / 60)} h` : `in ${min} min`;
}

export function ApprovalsList({ approvals, pendingHours, validMinutes }: { approvals: Approval[]; pendingHours: number; validMinutes: number }) {
  const { agents, tasks, refresh } = useLive();
  const router = useRouter();
  const pending = approvals.filter((a) => a.decision === "pending");
  const decided = approvals.filter((a) => a.decision !== "pending").slice(0, 100);

  async function decide(id: string, d: "approved" | "denied") {
    await decideApprovalAction(id, d);
    await refresh();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 font-semibold">Waiting for you ({pending.length})</h2>
        {!pending.length ? (
          <EmptyState
            title="Nothing to approve"
            hint={`When an agent asks, the request shows up here and its task moves to Waiting on you. A request nobody decides on expires after ${pendingHours} h, and an approval has to be used within ${validMinutes} min.`}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((a) => {
              const agent = agents.find((x) => x.id === a.agentId);
              const task = tasks.find((t) => t.id === a.taskId);
              return (
                <li key={a.id} className="card flex flex-wrap items-center gap-4 p-4" style={{ borderLeft: `4px solid ${RISK[a.risk]}` }}>
                  <AgentAvatar agent={agent} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {a.action}
                      {a.service && <span className="rounded bg-canvas px-1.5 py-0.5 text-xs font-normal text-ink-soft">{a.service}</span>}
                    </p>
                    {a.reason && <p className="mt-0.5 text-sm text-ink-soft">{a.reason}</p>}
                    {a.details && (
                      <details className="mt-2 text-sm" open={a.details.length < 400}>
                        <summary className="cursor-pointer text-xs text-ink-faint">What goes out</summary>
                        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-xs">{a.details}</pre>
                      </details>
                    )}
                    <p className="mt-1 text-xs text-ink-faint">
                      {agent?.name ?? "Agent"} · {a.risk} risk{task ? ` · ${task.title}` : ""} · {timeAgo(a.createdAt)} · expires {timeUntil(a.createdAt + pendingHours * 3_600_000)}
                    </p>
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                    <button type="button" className="btn-ghost justify-center border border-line" onClick={() => decide(a.id, "denied")}>Deny</button>
                    <button type="button" className="btn-primary justify-center" onClick={() => decide(a.id, "approved")}>Approve</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {decided.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">History</h2>
          <ul className="card divide-y divide-line">
            {decided.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium text-white ${DECISION_STYLE[a.decision as keyof typeof DECISION_STYLE]}`}>
                  {a.decision}
                </span>
                <span className="min-w-0 flex-1 truncate" title={a.details || a.action}>{a.action}</span>
                {a.service && <span className="text-xs text-ink-soft">{a.service}</span>}
                <span className="text-xs text-ink-faint">
                  {agents.find((x) => x.id === a.agentId)?.name} · {timeAgo(a.decidedAt)}
                  {a.decision === "approved" && (a.consumedAt ? ` · used ${timeAgo(a.consumedAt)}` : " · not used yet")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
