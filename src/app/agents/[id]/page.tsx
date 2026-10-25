import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentControls } from "@/components/agents/agent-controls";
import { AgentTimeline } from "@/components/agents/agent-timeline";
import { RefreshOnTick } from "@/components/refresh-on-tick";
import { AgentAvatar, ProviderTag } from "@/components/ui";
import { sandboxesAvailable } from "@/lib/sandbox/provider";
import { getAgent, getCommands, getEvents, getRuns, getTasks } from "@/lib/data";
import { AGENT_STATUS_META, COLUMN_META, compact, timeAgo, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();
  const [events, runs, commands, tasks] = await Promise.all([
    getEvents({ agentId: id, limit: 80 }),
    getRuns({ agentId: id, limit: 30 }),
    getCommands(id),
    getTasks(),
  ]);
  const mine = tasks.filter((t) => t.ownerAgentId === id);
  const status = AGENT_STATUS_META[agent.status];

  return (
    <div>
      <RefreshOnTick />
      <header className="border-b border-line bg-white px-6 py-5">
        <Link href="/agents" className="text-sm text-ink-soft hover:text-ink">← Agents</Link>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <AgentAvatar agent={agent} size={52} />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {agent.name}
              {agent.role === "lead" && <span className="rounded bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">Team lead</span>}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <ProviderTag provider={agent.provider} />
              <span className="font-mono">{agent.model}</span>
              <span>·</span>
              <span>{agent.kind}</span>
              {agent.machine && (<><span>·</span><span>{agent.machine}</span></>)}
              <span>·</span>
              <span>Last seen {timeAgo(agent.lastHeartbeat)}</span>
            </p>
            {agent.skills.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1">
                {agent.skills.map((s) => (
                  <span key={s} className="rounded bg-canvas px-2 py-0.5 text-xs text-ink-soft">{s}</span>
                ))}
              </p>
            )}
          </div>
          <span className="rounded-full px-3 py-1 text-sm font-medium text-white" style={{ background: status.color }}>{status.label}</span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-5">
        {[
          ["Tokens in", compact(agent.tokensIn)],
          ["Tokens out", compact(agent.tokensOut)],
          ["Cost", usd(agent.costUsd)],
          ["Runs", String(runs.length)],
          ["Open tasks", String(mine.filter((t) => t.column !== "done").length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-white px-6 py-3">
            <p className="text-xs text-ink-faint">{k}</p>
            <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Tasks</h2>
            {mine.length ? (
              <ul>
                {mine.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLUMN_META[t.column].color }} />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-ink-soft">{COLUMN_META[t.column].label}</span>
                    <span className="w-10 text-right font-mono text-xs tabular-nums">{t.progressPct}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-ink-soft">No tasks assigned. Assign one from the board.</p>
            )}
          </section>
          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Activity</h2>
            <div className="p-4"><AgentTimeline events={events} /></div>
          </section>
          <section className="card overflow-x-auto">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Runs</h2>
            {runs.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-faint">
                  <tr>
                    <th className="px-4 py-2 font-medium">Started</th>
                    <th className="px-4 py-2 font-medium">Model</th>
                    <th className="px-4 py-2 text-right font-medium">In</th>
                    <th className="px-4 py-2 text-right font-medium">Out</th>
                    <th className="px-4 py-2 text-right font-medium">Cost</th>
                    <th className="px-4 py-2 font-medium">Outcome</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs tabular-nums">
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-4 py-2 font-sans">{timeAgo(r.startedAt)}</td>
                      <td className="px-4 py-2">{r.model}</td>
                      <td className="px-4 py-2 text-right">{compact(r.tokensIn)}</td>
                      <td className="px-4 py-2 text-right">{compact(r.tokensOut)}</td>
                      <td className="px-4 py-2 text-right">{usd(r.costUsd)}</td>
                      <td className="px-4 py-2 font-sans">{r.outcome ?? (r.endedAt ? "ended" : "running")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-sm text-ink-soft">No runs reported yet.</p>
            )}
          </section>
        </div>
        <AgentControls agentId={agent.id} agentName={agent.name} paused={agent.status === "paused"} provider={agent.provider} model={agent.model} role={agent.role}
          commands={commands}
          sandbox={agent.kind === "hosted" ? { enabled: agent.sandboxEnabled, ready: await sandboxesAvailable() } : null}
        />
      </div>
    </div>
  );
}
