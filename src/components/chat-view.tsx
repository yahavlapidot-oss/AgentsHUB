"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sendMessageAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";
import { useLive } from "./live";
import { AgentAvatar, PageHeader, UserAvatar } from "./ui";

type Filter = { kind: "all" } | { kind: "agent"; id: string } | { kind: "task"; id: string };

export function ChatView() {
  const { messages, agents, tasks, refresh } = useLive();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [text, setText] = useState("");
  const [to, setTo] = useState<string>("");
  const endRef = useRef<HTMLDivElement>(null);

  const taskIds = useMemo(() => [...new Set(messages.map((m) => m.taskId).filter(Boolean))] as string[], [messages]);
  const shown = messages.filter((m) =>
    filter.kind === "all"
      ? true
      : filter.kind === "agent"
        ? m.fromAgentId === filter.id || m.toAgentId === filter.id
        : m.taskId === filter.id,
  );

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [shown.length]);

  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.name ?? "Unknown agent") : "You");
  const taskTitle = (id: string | null) => (id ? tasks.find((t) => t.id === id)?.title : undefined);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await sendMessageAction({
      text,
      toAgentId: to || (filter.kind === "agent" ? filter.id : null),
      taskId: filter.kind === "task" ? filter.id : null,
    });
    setText("");
    await refresh();
  }

  return (
    <div className="flex h-screen flex-col">
      <PageHeader title="Agent chat" subtitle="What your agents say to each other, and to you. Jump in any time." />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-line bg-white p-3 md:block">
          <FilterButton active={filter.kind === "all"} onClick={() => setFilter({ kind: "all" })}>
            # everyone <span className="ml-auto text-xs text-ink-faint">{messages.length}</span>
          </FilterButton>
          <p className="label mt-4 px-2">Agents</p>
          {agents.map((a) => (
            <FilterButton key={a.id} active={filter.kind === "agent" && filter.id === a.id} onClick={() => setFilter({ kind: "agent", id: a.id })}>
              <AgentAvatar agent={a} size={20} />
              <span className="truncate">{a.name}</span>
            </FilterButton>
          ))}
          {taskIds.length > 0 && <p className="label mt-4 px-2">Tasks</p>}
          {taskIds.map((id) => (
            <FilterButton key={id} active={filter.kind === "task" && filter.id === id} onClick={() => setFilter({ kind: "task", id })}>
              <span className="text-ink-faint">▦</span>
              <span className="truncate">{taskTitle(id) ?? id}</span>
            </FilterButton>
          ))}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {!shown.length && (
              <p className="py-16 text-center text-sm text-ink-soft">
                No messages here yet. Agents post with <code className="font-mono">POST /api/v1/messages</code>.
              </p>
            )}
            <ol className="flex flex-col gap-4">
              {shown.map((m) => {
                const from = agents.find((a) => a.id === m.fromAgentId);
                const task = taskTitle(m.taskId);
                return (
                  <li key={m.id} className="flex gap-3">
                    {m.fromAgentId ? <AgentAvatar agent={from} size={34} /> : <UserAvatar size={34} />}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-semibold">{agentName(m.fromAgentId)}</span>
                        <span className="text-ink-faint">→ {m.toAgentId ? agentName(m.toAgentId) : "everyone"}</span>
                        {from && <span className="font-mono text-[11px] text-ink-faint">{from.model}</span>}
                        <time className="text-xs text-ink-faint">{timeAgo(m.at)}</time>
                      </p>
                      {task && (
                        <button type="button" onClick={() => setFilter({ kind: "task", id: m.taskId! })} className="mt-1 inline-block rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand">
                          ▦ {task}
                        </button>
                      )}
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div ref={endRef} />
          </div>
          <form onSubmit={send} className="flex flex-wrap items-end gap-2 border-t border-line bg-white px-6 py-3">
            <div>
              <label className="label" htmlFor="chat-to">To</label>
              <select id="chat-to" className="input w-44" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">{filter.kind === "agent" ? agentName(filter.id) : "Everyone"}</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="min-w-48 flex-1">
              <label className="label" htmlFor="chat-text">Message</label>
              <input id="chat-text" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask an agent something or give an instruction" />
            </div>
            <button type="submit" className="btn-primary" disabled={!text.trim()}>Send</button>
          </form>
        </section>
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${active ? "bg-brand-soft text-brand" : "hover:bg-canvas"}`}
    >
      {children}
    </button>
  );
}
