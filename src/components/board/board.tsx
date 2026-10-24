"use client";

import { useMemo, useState } from "react";
import { useLive } from "../live";
import { AgentAvatar, PageHeader } from "../ui";
import { compact } from "@/lib/format";
import { KanbanView } from "./kanban-view";
import { NewTaskDialog } from "./new-task-dialog";
import { TableView } from "./table-view";
import { TaskDrawer } from "./task-drawer";

type View = "table" | "kanban";

export function Board() {
  const { tasks, agents } = useLive();
  const [view, setView] = useState<View>("table");
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState<string | "all" | "none">("all");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (agentFilter === "none" && t.ownerAgentId) return false;
      if (agentFilter !== "all" && agentFilter !== "none" && t.ownerAgentId !== agentFilter) return false;
      return !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    });
  }, [tasks, query, agentFilter]);

  return (
    <div>
      <PageHeader
        title="Main board"
        subtitle="Everything your agents are working on. Click a task to see its updates and activity."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            + New task
          </button>
        }
      />
      <Summary />

      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-6 py-2">
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            id="board-search"
            className="input w-48"
            placeholder="Search tasks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex items-center gap-1" aria-label="Filter by agent">
            <FilterChip active={agentFilter === "all"} onClick={() => setAgentFilter("all")}>
              All
            </FilterChip>
            {agents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgentFilter(agentFilter === a.id ? "all" : a.id)}
                className={`rounded-full p-0.5 ${agentFilter === a.id ? "ring-2 ring-brand" : "opacity-80 hover:opacity-100"}`}
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

      <div className="p-6">
        {view === "table" ? (
          <TableView tasks={visible} onOpen={setOpenTaskId} onCreate={() => setCreating(true)} />
        ) : (
          <KanbanView tasks={visible} onOpen={setOpenTaskId} />
        )}
      </div>

      {openTaskId && <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
      {creating && <NewTaskDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        active ? "bg-brand-soft text-brand" : "text-ink-soft hover:bg-black/5"
      }`}
    >
      {children}
    </button>
  );
}

function Summary() {
  const { tasks, agents, approvals } = useLive();
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
        <div key={s.label} className={`bg-white px-6 py-3 ${i === stats.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}>
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
