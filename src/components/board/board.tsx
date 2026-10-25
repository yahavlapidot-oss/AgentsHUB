"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLive } from "../live";
import { AgentAvatar, PageHeader } from "../ui";
import { compact } from "@/lib/format";
import { isProjectMember, projectLead } from "@/lib/project-lead";
import type { Task } from "@/lib/schema";
import { KanbanView } from "./kanban-view";
import { NewTaskDialog } from "./new-task-dialog";
import { TableView } from "./table-view";
import { TaskDrawer } from "./task-drawer";

type View = "table" | "kanban";
/** Which project's tasks the board shows: one project, tasks in no project, or all. */
export type ProjectScope = "all" | "none" | (string & {});

export function inScope(t: Pick<Task, "projectId">, scope: ProjectScope): boolean {
  return scope === "all" ? true : scope === "none" ? !t.projectId : t.projectId === scope;
}

export function Board({ initialProject = "all", initialTaskId = null }: { initialProject?: ProjectScope; initialTaskId?: string | null }) {
  const { tasks: allTasks, agents: allAgents, projects } = useLive();
  const [scope, setScopeState] = useState<ProjectScope>(initialProject);
  const project = projects.find((p) => p.id === scope);
  const tasks = useMemo(() => allTasks.filter((t) => inScope(t, scope)), [allTasks, scope]);
  // A project's board shows only the agents who may work on it.
  const agents = project ? allAgents.filter((a) => isProjectMember(project, a.id)) : allAgents;
  const lead = project ? projectLead(project, allAgents) : null;
  const [view, setView] = useState<View>("table");
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<string | "all" | "none">("all");
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTaskId ?? null);
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (agentFilter === "none" && t.ownerAgentId) return false;
      if (agentFilter !== "all" && agentFilter !== "none" && t.ownerAgentId !== agentFilter) return false;
      return !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    });
  }, [tasks, query, agentFilter]);

  // The URL keeps the project, so a link or a reload opens the same board.
  function setScope(next: ProjectScope) {
    setScopeState(next);
    setAgentFilter("all");
    window.history.replaceState(null, "", next === "all" ? "/" : `/?project=${encodeURIComponent(next)}`);
  }

  return (
    <div>
      <PageHeader
        title={project ? project.name : scope === "none" ? "Tasks without a project" : "Main board"}
        subtitle={
          project
            ? project.goal || "This project's tasks. Click a task to see its updates and activity."
            : "Everything your agents are working on. Click a task to see its updates and activity."
        }
        actions={
          <>
            <label className="sr-only" htmlFor="board-project">Project</label>
            <select id="board-project" className="input w-auto max-w-[11rem]" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="none">No project</option>
            </select>
            {project && (
              <Link href={`/chat/${project.id}`} className="btn-ghost border border-line" title={lead ? `Chat with ${lead.name}` : "Pick a work manager"}>
                ✉ Chat
              </Link>
            )}
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              + New task
            </button>
          </>
        }
      />
      <Summary tasks={tasks} agents={agents} scoped={scope !== "all"} />

      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 sm:px-6 py-2">
        <div role="tablist" className="flex gap-1">
          {(["table", "kanban"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              type="button"
              onClick={() => setView(v)}
              className={`border-b-2 px-3 py-1.5 text-sm font-medium ${
                view === v ? "border-brand text-ink" : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {v === "table" ? "Main table" : "Kanban"}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <input
            id="board-search"
            className="input w-full sm:w-48"
            placeholder="Search tasks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="-mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1 py-0.5 sm:max-w-md" aria-label="Filter by agent">
            <FilterChip active={agentFilter === "all"} onClick={() => setAgentFilter("all")}>
              All
            </FilterChip>
            {agents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgentFilter(agentFilter === a.id ? "all" : a.id)}
                className={`shrink-0 rounded-full p-0.5 ${agentFilter === a.id ? "ring-2 ring-brand" : "opacity-80 hover:opacity-100"}`}
                aria-pressed={agentFilter === a.id}
                aria-label={`Only ${a.name}`}
              >
                <AgentAvatar agent={a} size={26} />
              </button>
            ))}
            <FilterChip active={agentFilter === "none"} onClick={() => setAgentFilter("none")}>
              Unassigned
            </FilterChip>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {view === "table" ? (
          <TableView tasks={visible} onOpen={setOpenTaskId} onCreate={() => setCreating(true)} />
        ) : (
          <KanbanView tasks={visible} onOpen={setOpenTaskId} />
        )}
      </div>

      {openTaskId && <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
      {creating && <NewTaskDialog projectId={project?.id} onClose={() => setCreating(false)} />}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
        active ? "bg-brand-soft text-brand" : "text-ink-soft hover:bg-black/5"
      }`}
    >
      {children}
    </button>
  );
}

function Summary({ tasks, agents, scoped }: { tasks: Task[]; agents: ReturnType<typeof useLive>["agents"]; scoped: boolean }) {
  const { approvals: allApprovals } = useLive();
  const ids = new Set(tasks.map((t) => t.id));
  const approvals = scoped ? allApprovals.filter((a) => a.taskId && ids.has(a.taskId)) : allApprovals;
  const dayAgo = Date.now() - 24 * 3600_000;
  const stats = [
    { label: "Agents working", value: `${agents.filter((a) => a.status === "active").length} / ${agents.length}` },
    { label: "In progress", value: tasks.filter((t) => t.column === "in_progress").length },
    {
      label: "Waiting on you",
      value: approvals.length + tasks.filter((t) => t.column === "waiting_on_you" && !approvals.some((a) => a.taskId === t.id)).length,
      alert: true,
    },
    { label: "Done in 24h", value: tasks.filter((t) => t.column === "done" && t.updatedAt > dayAgo).length },
    { label: "Tokens used", value: compact(agents.reduce((s, a) => s + a.tokensIn + a.tokensOut, 0)) },
  ];
  return (
    <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-5">
      {stats.map((s, i) => (
        <div key={s.label} className={`bg-white px-4 py-2 sm:px-6 sm:py-3 ${i === stats.length - 1 ? "hidden sm:block" : ""}`}>
          <p className="text-xs text-ink-faint">{s.label}</p>
          <p
            className={`mt-0.5 text-xl font-semibold tabular-nums ${
              s.alert && Number(s.value) > 0 ? "text-[#e2445c]" : ""
            }`}
          >
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}
