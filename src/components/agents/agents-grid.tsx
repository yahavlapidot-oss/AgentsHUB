"use client";

import Link from "next/link";
import { useState } from "react";
import { AGENT_STATUS_META, COLUMN_META, compact, timeAgo, usd } from "@/lib/format";
import { useLive } from "../live";
import { AgentAvatar, EmptyState, PageHeader, ProgressBar, ProviderTag } from "../ui";
import { ConnectAgentDialog } from "./connect-agent-dialog";

export function AgentsGrid() {
  const { agents, tasks } = useLive();
  const [connecting, setConnecting] = useState(false);

  return (
    <div>
      <PageHeader
        title="Agents"
        subtitle="Every agent that reports to this hub, what it is doing now, and what it has used."
        actions={
          <button type="button" className="btn-primary" onClick={() => setConnecting(true)}>
            + Connect agent
          </button>
        }
      />
      <div className="p-6">
        {!agents.length ? (
          <EmptyState
            title="No agents connected"
            hint="Connect a Claude, GPT or Gemini agent. You get an API key and a code snippet that reports its tasks, progress and token usage here."
            action={<button type="button" className="btn-primary" onClick={() => setConnecting(true)}>+ Connect agent</button>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((a) => {
              const current = tasks.find((t) => t.id === a.currentTaskId);
              const open = tasks.filter((t) => t.ownerAgentId === a.id && t.column !== "done").length;
              const status = AGENT_STATUS_META[a.status];
              return (
                <Link key={a.id} href={`/agents/${a.id}`} className="card flex flex-col gap-3 p-4 transition-shadow hover:shadow-md">
                  <div className="flex items-center gap-3">
                    <AgentAvatar agent={a} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{a.name}</p>
                      <p className="flex items-center gap-2 text-xs text-ink-soft">
                        <ProviderTag provider={a.provider} />
                        <span className="truncate font-mono">{a.model}</span>
                      </p>
                    </div>
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ background: status.color }}>
                      {status.label}
                    </span>
                  </div>
                  <div className="rounded-md bg-canvas p-3">
                    <p className="text-xs text-ink-faint">Now working on</p>
                    {current ? (
                      <>
                        <p className="mt-0.5 truncate text-sm font-medium">{current.title}</p>
                        <div className="mt-2">
                          <ProgressBar pct={current.progressPct} color={COLUMN_META[current.column].color} />
                        </div>
                      </>
                    ) : (
                      <p className="mt-0.5 text-sm text-ink-soft">Nothing right now</p>
                    )}
                  </div>
                  <dl className="grid grid-cols-4 gap-2 text-center">
                    <Stat label="Open tasks" value={String(open)} />
                    <Stat label="Tokens in" value={compact(a.tokensIn)} />
                    <Stat label="Tokens out" value={compact(a.tokensOut)} />
                    <Stat label="Cost" value={usd(a.costUsd)} />
                  </dl>
                  <p className="text-xs text-ink-faint">Last seen {timeAgo(a.lastHeartbeat)}{a.machine ? ` · ${a.machine}` : ""}</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      {connecting && <ConnectAgentDialog onClose={() => setConnecting(false)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
