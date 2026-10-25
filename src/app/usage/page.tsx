import Link from "next/link";
import { MonthlyCapForm } from "@/components/monthly-cap";
import { RefreshOnTick } from "@/components/refresh-on-tick";
import { AgentAvatar, PageHeader, ProviderTag } from "@/components/ui";
import { ALERT_AT, getComputerSpend, getMonthStatus, getSpend, getSpendByProject } from "@/lib/budgets";
import { getAgents, getProjects, getRuns, getUsage, type UsageRow } from "@/lib/data";
import { compact, timeAgo, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const [byAgent, byModel, agents, runs, month, allTime, byProject, computersByAgent, computersByModel, projects] = await Promise.all([
    getUsage("agent"),
    getUsage("model"),
    getAgents(),
    getRuns({ limit: 25 }),
    getMonthStatus(),
    getSpend(),
    getSpendByProject(),
    getComputerSpend("agent"),
    getComputerSpend("model"),
    getProjects(),
  ]);
  const share = month.cap ? Math.min(1, month.spent.total / month.cap) : 0;
  const total = byModel.reduce(
    (s, r) => ({ runs: s.runs + r.runs, tokensIn: s.tokensIn + r.tokensIn, tokensOut: s.tokensOut + r.tokensOut, costUsd: s.costUsd + r.costUsd }),
    { runs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
  );
  const agentById = new Map(agents.map((a) => [a.id, a]));

  return (
    <div>
      <RefreshOnTick />
      <PageHeader title="Usage & costs" subtitle="What your agents spend on models and cloud computers, and the caps that stop them." />
      <section className="border-b border-line bg-white px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-ink-faint">This month</p>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {usd(month.spent.total)}
              {month.cap != null && <span className="text-base font-normal text-ink-soft"> of {usd(month.cap)}</span>}
            </p>
            <p className="text-xs text-ink-soft">
              models {usd(month.spent.models)} · cloud computers {usd(month.spent.computers)}
            </p>
          </div>
          <MonthlyCapForm cap={month.cap} />
        </div>
        {month.cap != null && (
          <>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-canvas">
              <div
                className="h-full"
                style={{ width: `${share * 100}%`, background: share >= 1 ? "#d83a52" : share >= ALERT_AT ? "#fdab3d" : "#00c875" }}
              />
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              {share >= 1 ? "The cap is used up: agents won't start or continue work until next month or a higher cap." : `You get an email at ${ALERT_AT * 100}%. Agents stop at the cap.`}
            </p>
          </>
        )}
      </section>
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        {[
          ["Tokens in", compact(total.tokensIn)],
          ["Tokens out", compact(total.tokensOut)],
          ["All-time cost", usd(allTime.total)],
          ["Runs", String(total.runs)],
        ].map(([k, v]) => (
          <div key={k} className="bg-white px-6 py-3">
            <p className="text-xs text-ink-faint">{k}</p>
            <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <UsageBars
          title="By agent"
          rows={byAgent}
          computers={computersByAgent}
          label={(key) => {
            const a = agentById.get(key);
            return a ? (
              <span className="flex min-w-0 items-center gap-2">
                <AgentAvatar agent={a} size={20} />
                <span className="truncate">{a.name}</span>
              </span>
            ) : (
              <span className="text-ink-faint">Removed agent</span>
            );
          }}
        />
        <UsageBars title="By model" rows={byModel} computers={computersByModel} label={(key) => <span className="truncate font-mono text-xs">{key}</span>} />
        <section className="card overflow-x-auto lg:col-span-2">
          <h2 className="border-b border-line px-4 py-3 font-semibold">By project and cost type</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-faint">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 text-right font-medium">Models</th>
                <th className="px-4 py-2 text-right font-medium">Cloud computers</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-right font-medium">Budget</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const s = byProject.get(p.id) ?? { models: 0, computers: 0, total: 0 };
                const over = p.budgetUsd != null && s.total >= p.budgetUsd;
                return (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-4 py-2"><Link href={`/projects/${p.id}`} className="hover:underline">{p.name}</Link></td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{usd(s.models)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{usd(s.computers)}</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs tabular-nums ${over ? "text-[#d83a52]" : ""}`}>{usd(s.total)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-ink-soft">{p.budgetUsd != null ? usd(p.budgetUsd) : "none"}</td>
                  </tr>
                );
              })}
              {(() => {
                const inProjects = [...byProject.values()].reduce((a, s) => ({ models: a.models + s.models, computers: a.computers + s.computers }), { models: 0, computers: 0 });
                const models = Math.max(0, allTime.models - inProjects.models);
                const computers = Math.max(0, allTime.computers - inProjects.computers);
                return (
                  <tr className="border-t border-line text-ink-soft">
                    <td className="px-4 py-2">No project</td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{usd(models)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{usd(computers)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{usd(models + computers)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{month.cap != null ? "monthly cap" : "none"}</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </section>
        <section className="card overflow-x-auto lg:col-span-2">
          <h2 className="border-b border-line px-4 py-3 font-semibold">Recent runs</h2>
          {runs.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-faint">
                <tr>
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 text-right font-medium">Tokens in</th>
                  <th className="px-4 py-2 text-right font-medium">Tokens out</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                  <th className="px-4 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const a = agentById.get(r.agentId);
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          {a && <ProviderTag provider={a.provider} />}
                          {a?.name ?? "Removed agent"}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{r.model}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{r.tokensIn.toLocaleString("en-US")}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{r.tokensOut.toLocaleString("en-US")}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{usd(r.costUsd)}</td>
                      <td className="px-4 py-2 text-xs text-ink-soft">{timeAgo(r.startedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-6 text-sm text-ink-soft">No usage reported yet. Agents send it with <code className="font-mono">POST /api/v1/usage</code>.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Token bars. Cost includes cloud computer time; `computers` says how much of it per row. */
function UsageBars({
  title,
  rows,
  label,
  computers,
}: {
  title: string;
  rows: UsageRow[];
  label: (key: string) => React.ReactNode;
  computers?: Map<string, number>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.tokensIn + r.tokensOut));
  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="flex items-center gap-3 text-xs text-ink-faint">
          <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-brand" /> in</span>
          <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-[#a25ddc]" /> out</span>
        </span>
      </header>
      {rows.length ? (
        <ul className="flex flex-col gap-3 p-4">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-sm">
              {label(r.key)}
              <div className="flex h-3 overflow-hidden rounded-full bg-canvas" title={`${r.tokensIn.toLocaleString("en-US")} in · ${r.tokensOut.toLocaleString("en-US")} out`}>
                <div className="bg-brand" style={{ width: `${(r.tokensIn / max) * 100}%` }} />
                <div className="bg-[#a25ddc]" style={{ width: `${(r.tokensOut / max) * 100}%` }} />
              </div>
              <span className="w-28 text-right font-mono text-xs tabular-nums text-ink-soft">
                {compact(r.tokensIn + r.tokensOut)} · {usd(r.costUsd)}
                {computers?.get(r.key) ? <span className="block text-ink-faint">{usd(computers.get(r.key)!)} computers</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-sm text-ink-soft">Nothing reported yet.</p>
      )}
    </section>
  );
}
