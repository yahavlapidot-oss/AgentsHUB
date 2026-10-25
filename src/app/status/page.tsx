import { RefreshOnTick } from "@/components/refresh-on-tick";
import { PageHeader } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { getSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

const COLOR = { ok: "#00c875", off: "#c4c4c4", problem: "#e2445c" } as const;
const LABEL = { ok: "Working", off: "Off", problem: "Problem" } as const;

export default async function StatusPage() {
  const status = await getSystemStatus();
  const bad = status.checks.filter((c) => c.state === "problem").length;
  return (
    <div>
      <RefreshOnTick />
      <PageHeader
        title="System status"
        subtitle={bad ? `${bad} thing${bad === 1 ? "" : "s"} need${bad === 1 ? "s" : ""} a look.` : "Everything that should be working is working."}
      />
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <section className="card">
          <ul>
            {status.checks.map((c) => (
              <li key={c.name} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR[c.state] }} />
                <span className="w-36 font-medium">{c.name}</span>
                <span className="text-xs font-medium" style={{ color: COLOR[c.state] === "#c4c4c4" ? "#676879" : COLOR[c.state] }}>{LABEL[c.state]}</span>
                <span className="min-w-0 flex-1 text-sm text-ink-soft">{c.detail}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2 className="border-b border-line px-4 py-3 font-semibold">Server problems since the last restart</h2>
          {status.problems.length ? (
            <ul>
              {status.problems.map((p, i) => (
                <li key={i} className="border-b border-line px-4 py-2 text-sm last:border-b-0">
                  <span className="mr-2 font-mono text-xs text-ink-faint">{timeAgo(p.at)}</span>
                  <span className="mr-2 rounded bg-canvas px-1.5 py-0.5 text-xs">{p.source}</span>
                  <span className="break-words">{p.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-ink-soft">None. Agent errors on tasks are on the tasks and in the audit log ({status.agentErrors24h} in the last 24 hours).</p>
          )}
        </section>
        {status.version && <p className="text-xs text-ink-faint">Running commit {status.version}</p>}
      </div>
    </div>
  );
}
