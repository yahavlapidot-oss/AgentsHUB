"use client";

import { useRouter } from "next/navigation";
import { decideApprovalAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";
import type { Approval } from "@/lib/schema";
import { useLive } from "./live";
import { AgentAvatar, EmptyState } from "./ui";

const RISK = { low: "#00c875", medium: "#fdab3d", high: "#e2445c" } as const;

export function ApprovalsList({ approvals }: { approvals: Approval[] }) {
  const { agents, tasks, refresh } = useLive();
  const router = useRouter();
  const pending = approvals.filter((a) => a.decision === "pending");
  const decided = approvals.filter((a) => a.decision !== "pending").slice(0, 30);

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
          <EmptyState title="Nothing to approve" hint="When an agent calls POST /api/v1/approvals, the request shows up here and its task moves to Waiting on you." />
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((a) => {
              const agent = agents.find((x) => x.id === a.agentId);
              const task = tasks.find((t) => t.id === a.taskId);
              return (
                <li key={a.id} className="card flex flex-wrap items-center gap-4 p-4" style={{ borderLeft: `4px solid ${RISK[a.risk]}` }}>
                  <AgentAvatar agent={agent} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.action}</p>
                    {a.reason && <p className="mt-0.5 text-sm text-ink-soft">{a.reason}</p>}
                    <p className="mt-1 text-xs text-ink-faint">
                      {agent?.name ?? "Agent"} · {a.risk} risk{task ? ` · ${task.title}` : ""} · {timeAgo(a.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-ghost border border-line" onClick={() => decide(a.id, "denied")}>Deny</button>
                    <button type="button" className="btn-primary" onClick={() => decide(a.id, "approved")}>Approve</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {decided.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Decided</h2>
          <ul className="card divide-y divide-line">
            {decided.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium text-white ${a.decision === "approved" ? "bg-[#00c875]" : "bg-[#e2445c]"}`}>
                  {a.decision}
                </span>
                <span className="min-w-0 flex-1 truncate">{a.action}</span>
                <span className="text-xs text-ink-faint">{agents.find((x) => x.id === a.agentId)?.name} · {timeAgo(a.decidedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
