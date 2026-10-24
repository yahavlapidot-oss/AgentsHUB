"use client";

import { useState } from "react";
import { updateTaskAction } from "@/app/actions";
import { COLUMN_META, PRIORITY_META, timeAgo } from "@/lib/format";
import { COLUMNS, type Column, type Priority, type Task } from "@/lib/schema";
import { useLive } from "../live";
import { AgentAvatar, ColorPicker, EmptyState, ProgressBar } from "../ui";
import { OwnerPicker } from "./owner-picker";

const GRID = "grid grid-cols-[minmax(240px,2.4fr)_120px_150px_120px_minmax(140px,1fr)_110px_90px]";

export function TableView({
  tasks,
  onOpen,
  onCreate,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<Column>>(new Set());
  if (!tasks.length) {
    return (
      <EmptyState
        title="No tasks here yet"
        hint="Create a task and assign it to an agent, or let a connected agent create its own tasks through the API."
        action={
          <button type="button" className="btn-primary" onClick={onCreate}>
            + New task
          </button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-8 overflow-x-auto pb-4">
      {COLUMNS.map((col) => {
        const rows = tasks.filter((t) => t.column === col);
        if (!rows.length) return null;
        const meta = COLUMN_META[col];
        const isCollapsed = collapsed.has(col);
        return (
          <section key={col} className="min-w-[1000px]">
            <button
              type="button"
              className="mb-2 flex items-center gap-2 text-[15px] font-semibold"
              style={{ color: meta.color === "#c4c4c4" ? "#676879" : meta.color }}
              onClick={() =>
                setCollapsed((s) => {
                  const n = new Set(s);
                  n.has(col) ? n.delete(col) : n.add(col);
                  return n;
                })
              }
              aria-expanded={!isCollapsed}
            >
              <span className={`inline-block transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
              {meta.label}
              <span className="text-xs font-normal text-ink-faint">{rows.length} {rows.length === 1 ? "task" : "tasks"}</span>
            </button>
            {!isCollapsed && (
              <div className="overflow-hidden rounded-md border border-line bg-white" style={{ borderLeft: `6px solid ${meta.color}` }}>
                <div className={`${GRID} border-b border-line text-xs font-medium text-ink-soft`}>
                  <Head>Task</Head>
                  <Head center>Owner</Head>
                  <Head center>Status</Head>
                  <Head center>Priority</Head>
                  <Head>Progress</Head>
                  <Head center>Model</Head>
                  <Head center>Updated</Head>
                </div>
                {rows.map((t) => (
                  <Row key={t.id} task={t} onOpen={() => onOpen(t.id)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Head({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <div className={`border-r border-line px-3 py-2 last:border-r-0 ${center ? "text-center" : ""}`}>{children}</div>;
}

function Row({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { agents, messages, refresh } = useLive();
  const owner = agents.find((a) => a.id === task.ownerAgentId);
  const updates = messages.filter((m) => m.taskId === task.id).length;

  async function patch(p: Parameters<typeof updateTaskAction>[1]) {
    await updateTaskAction(task.id, p);
    await refresh();
  }

  return (
    <div className={`${GRID} group border-b border-line text-sm last:border-b-0 hover:bg-[#f5f6f8]`}>
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2 border-r border-line px-3 py-2 text-left">
        <span className="truncate">{task.title}</span>
        {updates > 0 && (
          <span className="shrink-0 rounded-full bg-brand-soft px-1.5 text-[11px] font-medium text-brand" title="Updates">
            {updates}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-brand opacity-0 group-hover:opacity-100">Open</span>
      </button>
      <div className="flex items-center justify-center border-r border-line">
        <OwnerPicker value={task.ownerAgentId} onChange={(id) => patch({ ownerAgentId: id })}>
          <AgentAvatar agent={owner} size={28} />
        </OwnerPicker>
      </div>
      <ColorPicker<Column>
        className="border-r border-line"
        value={task.column}
        options={COLUMN_META}
        onChange={(c) => patch({ column: c })}
      />
      <ColorPicker<Priority>
        className="border-r border-line"
        value={task.priority}
        options={PRIORITY_META}
        onChange={(p) => patch({ priority: p })}
      />
      <div className="flex items-center border-r border-line px-3">
        <div className="w-full">
          <ProgressBar pct={task.progressPct} color={COLUMN_META[task.column].color} />
        </div>
      </div>
      <div className="flex items-center justify-center truncate border-r border-line px-2 font-mono text-[11px] text-ink-soft">
        {owner?.model ?? "—"}
      </div>
      <div className="flex items-center justify-center px-2 text-xs text-ink-soft">{timeAgo(task.updatedAt)}</div>
    </div>
  );
}
