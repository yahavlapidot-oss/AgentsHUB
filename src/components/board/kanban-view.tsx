"use client";

import { useState } from "react";
import { COLUMN_META, PRIORITY_META, timeAgo } from "@/lib/format";
import { COLUMNS, type Column, type Task } from "@/lib/schema";
import { useLive } from "../live";
import { AgentAvatar, ProgressBar } from "../ui";

/** Drag cards between columns to change their status. */
export function KanbanView({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const { agents, updateTask } = useLive();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Column | null>(null);

  async function drop(col: Column) {
    const id = dragId;
    setDragId(null);
    setOver(null);
    const task = tasks.find((t) => t.id === id);
    if (!task || task.column === col) return;
    await updateTask(task.id, { column: col }, `Moved to ${COLUMN_META[col].label}`);
  }

  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:snap-none sm:gap-4 sm:px-0">
      {COLUMNS.map((col) => {
        const meta = COLUMN_META[col];
        const cards = tasks.filter((t) => t.column === col);
        return (
          <section
            key={col}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col);
            }}
            onDragLeave={() => setOver((o) => (o === col ? null : o))}
            onDrop={() => drop(col)}
            className={`flex w-[85vw] max-w-72 shrink-0 snap-start flex-col rounded-lg sm:w-72 bg-[#eceff4] transition-shadow ${
              over === col ? "ring-2 ring-brand" : ""
            }`}
          >
            <header
              className="flex items-center justify-between rounded-t-lg px-3 py-2 text-sm font-semibold"
              style={{ background: meta.color, color: meta.text }}
            >
              {meta.label}
              <span className="text-xs font-normal opacity-80">{cards.length}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-2 p-2">
              {cards.map((t) => {
                const owner = agents.find((a) => a.id === t.ownerAgentId);
                return (
                  <button
                    key={t.id}
                    type="button"
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => onOpen(t.id)}
                    className={`card flex flex-col gap-2 p-3 text-left text-sm shadow-sm hover:shadow ${
                      dragId === t.id ? "opacity-50" : ""
                    }`}
                  >
                    <span className="font-medium leading-snug">{t.title}</span>
                    <ProgressBar pct={t.progressPct} color={meta.color} />
                    <span className="flex items-center gap-2">
                      <AgentAvatar agent={owner} size={22} />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{owner?.name ?? "Unassigned"}</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: PRIORITY_META[t.priority].color, color: PRIORITY_META[t.priority].text }}
                      >
                        {PRIORITY_META[t.priority].label}
                      </span>
                    </span>
                    <span className="text-[11px] text-ink-faint">Updated {timeAgo(t.updatedAt)}</span>
                  </button>
                );
              })}
              {!cards.length && <p className="px-1 py-4 text-center text-xs text-ink-faint">Drop tasks here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
