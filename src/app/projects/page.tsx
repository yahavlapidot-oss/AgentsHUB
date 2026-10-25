import Link from "next/link";
import { ProjectForm } from "@/components/projects/project-form";
import { RefreshOnTick } from "@/components/refresh-on-tick";
import { PageHeader } from "@/components/ui";
import { getAgents, getArtifacts, getProjectCosts, getProjects, getTasks } from "@/lib/data";
import { usd, PROJECT_STATUS_LABELS as STATUS_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const [projects, tasks, agents, costs, files] = await Promise.all([getProjects(), getTasks(), getAgents(), getProjectCosts(), getArtifacts({ latestOnly: true, limit: 5_000 })]);
  return (
    <div>
      <RefreshOnTick />
      <PageHeader
        title="Projects"
        subtitle="Group tasks into a project and its agents share one workspace: the same files, goal and decisions. The next agent picks up where the last one stopped."
      />
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-w-0 flex-col gap-3">
          {projects.length ? (
            projects.map((p) => {
              const mine = tasks.filter((t) => t.projectId === p.id);
              const done = mine.filter((t) => t.column === "done").length;
              const pct = mine.length ? Math.round(mine.reduce((n, t) => n + t.progressPct, 0) / mine.length) : 0;
              const members = p.memberAgentIds.map((id) => agents.find((a) => a.id === id)?.name ?? "Removed agent");
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="card block p-4 hover:ring-brand">
                  <div className="flex items-start gap-3">
                    <h2 className="min-w-0 flex-1 font-semibold">{p.name}</h2>
                    <span className="rounded bg-canvas px-2 py-0.5 text-xs text-ink-soft">{STATUS_LABELS[p.status]}</span>
                  </div>
                  {p.goal && <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{p.goal}</p>}
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas">
                    <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-ink-faint">
                    <span>{done}/{mine.length} tasks done</span>
                    <span>{files.filter((f) => f.projectId === p.id).length} files</span>
                    <span>{usd(costs.get(p.id) ?? 0)} spent</span>
                    <span>{members.length ? members.join(", ") : "Every agent"}</span>
                  </p>
                </Link>
              );
            })
          ) : (
            <div className="card p-8 text-center text-sm text-ink-soft">
              No projects yet. Create one for work that spans several tasks, like an app or a report, so the agents share its files and decisions.
            </div>
          )}
        </section>
        <div className="self-start">
          <ProjectForm agents={agents} />
        </div>
      </div>
    </div>
  );
}
