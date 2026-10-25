import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtifactsList } from "@/components/artifacts-list";
import { NewProjectTask } from "@/components/projects/new-project-task";
import { ProjectForm } from "@/components/projects/project-form";
import { RefreshOnTick } from "@/components/refresh-on-tick";
import { getAgents, getArtifacts, getProject, getProjectCosts, getTasks } from "@/lib/data";
import { COLUMN_META, usd, PROJECT_STATUS_LABELS as STATUS_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const [tasks, agents, costs, files] = await Promise.all([getTasks(), getAgents(), getProjectCosts(), getArtifacts({ projectId: id, limit: 2_000 })]);
  const mine = tasks.filter((t) => t.projectId === id);
  const latest = new Set<string>();
  const workspace = files.filter((f) => !latest.has(f.path) && latest.add(f.path));
  const name = (agentId: string | null) => agents.find((a) => a.id === agentId)?.name ?? "Unassigned";

  return (
    <div>
      <RefreshOnTick />
      <header className="border-b border-line bg-white px-6 py-5">
        <Link href="/projects" className="text-sm text-ink-soft hover:text-ink">← Projects</Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">{project.name}</h1>
          <span className="rounded bg-canvas px-2 py-0.5 text-sm text-ink-soft">{STATUS_LABELS[project.status]}</span>
          <NewProjectTask projectId={id} />
        </div>
        {project.goal && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-ink-soft">{project.goal}</p>}
      </header>

      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        {[
          ["Tasks", String(mine.length)],
          ["Done", String(mine.filter((t) => t.column === "done").length)],
          ["Files", String(workspace.length)],
          ["Spent", usd(costs.get(id) ?? 0)],
        ].map(([k, v]) => (
          <div key={k} className="bg-white px-6 py-3">
            <p className="text-xs text-ink-faint">{k}</p>
            <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Tasks</h2>
            {mine.length ? (
              <ul>
                {mine.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLUMN_META[t.column].color }} />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-ink-soft">{name(t.ownerAgentId)}</span>
                    <span className="text-xs text-ink-soft">{COLUMN_META[t.column].label}</span>
                    <span className="w-10 text-right font-mono text-xs tabular-nums">{t.progressPct}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-ink-soft">No tasks yet. Add one with New task, or move a task here from its details on the board.</p>
            )}
          </section>
          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Shared workspace</h2>
            <p className="px-4 pt-3 text-sm text-ink-soft">
              Files any task in this project saved, with one version history per path. An agent's cloud computer starts with the latest of each.
            </p>
            <div className="p-4"><ArtifactsList artifacts={files} showTask /></div>
          </section>
        </div>
        <div className="self-start">
          <ProjectForm project={project} agents={agents} />
        </div>
      </div>
    </div>
  );
}
