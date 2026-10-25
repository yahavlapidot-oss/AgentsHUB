import Link from "next/link";
import { RefreshOnTick } from "@/components/refresh-on-tick";
import { PageHeader } from "@/components/ui";
import { getAgents, getAuditLog, getTasks, type AuditEntry } from "@/lib/data";

export const dynamic = "force-dynamic";

const KIND: Record<AuditEntry["kind"], { label: string; className: string }> = {
  tool: { label: "Tool", className: "bg-canvas text-ink-soft" },
  file: { label: "File", className: "bg-[#e5f4ff] text-[#0b5394]" },
  status: { label: "Status", className: "bg-canvas text-ink-soft" },
  note: { label: "Note", className: "bg-canvas text-ink-soft" },
  error: { label: "Error", className: "bg-[#fde8ec] text-[#a1203a]" },
  approval: { label: "Approval", className: "bg-[#fff6e5] text-[#7a4a00]" },
  command: { label: "You", className: "bg-brand-soft text-brand" },
};

function stamp(at: number): string {
  return new Date(at).toISOString().replace("T", " ").slice(0, 19);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { agent } = await searchParams;
  const [entries, agents, tasks] = await Promise.all([getAuditLog({ agentId: agent || undefined, limit: 500 }), getAgents(), getTasks()]);
  const taskTitle = (id: string | null) => (id ? tasks.find((t) => t.id === id)?.title : undefined);
  return (
    <div>
      <RefreshOnTick />
      <PageHeader
        title="Audit log"
        subtitle="Everything agents did and everything you decided, newest first: tool calls, files, approvals asked, decided and used, and your commands. Times are UTC."
      />
      <div className="p-6">
        <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Filter by agent">
          <Link href="/audit" className={`rounded-full px-3 py-1 ${!agent ? "bg-ink text-white" : "bg-white ring-1 ring-line"}`}>Everyone</Link>
          {agents.map((a) => (
            <Link key={a.id} href={`/audit?agent=${a.id}`} className={`rounded-full px-3 py-1 ${agent === a.id ? "bg-ink text-white" : "bg-white ring-1 ring-line"}`}>
              {a.name}
            </Link>
          ))}
        </nav>
        {entries.length ? (
          <ol className="card divide-y divide-line">
            {entries.map((e, i) => (
              <li key={i} className="grid grid-cols-[150px_90px_minmax(0,1fr)] items-start gap-3 px-4 py-2 text-sm max-md:grid-cols-1">
                <span className="font-mono text-xs text-ink-faint">{stamp(e.at)}</span>
                <span><span className={`rounded px-1.5 py-0.5 text-xs ${KIND[e.kind].className}`}>{KIND[e.kind].label}</span></span>
                <div className="min-w-0">
                  <p className="break-words">
                    <span className="font-medium">{e.actor}</span> {e.text}
                  </p>
                  {(taskTitle(e.taskId) || e.detail) && (
                    <p className="mt-0.5 truncate font-mono text-xs text-ink-faint" title={e.detail}>
                      {taskTitle(e.taskId) && <span className="font-sans">{taskTitle(e.taskId)} · </span>}
                      {e.detail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="card p-8 text-center text-sm text-ink-soft">Nothing recorded yet.</div>
        )}
      </div>
    </div>
  );
}
