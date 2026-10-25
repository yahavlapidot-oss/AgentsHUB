"use client";

import { useCallback, useEffect, useState } from "react";
import { getTaskDetailAction, sendMessageAction, updateTaskAction } from "@/app/actions";
import { COLUMN_META, PRIORITY_META, timeAgo, usd } from "@/lib/format";
import type { AgentEvent, ArtifactInfo, Column, Message, Priority } from "@/lib/schema";
import { ArtifactsList } from "../artifacts-list";
import { describeEvent } from "../event-line";
import { useLive } from "../live";
import { AgentAvatar, ColorPicker, ProgressBar, ProviderTag, UserAvatar } from "../ui";
import { OwnerPicker } from "./owner-picker";

type Tab = "updates" | "activity" | "files" | "details";

export function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { tasks, agents, refresh, generatedAt } = useLive();
  const task = tasks.find((t) => t.id === taskId);
  const [tab, setTab] = useState<Tab>("updates");
  const [detail, setDetail] = useState<{ events: AgentEvent[]; messages: Message[]; artifacts: ArtifactInfo[] }>({
    events: [],
    messages: [],
    artifacts: [],
  });

  const load = useCallback(async () => setDetail(await getTaskDetailAction(taskId)), [taskId]);
  // Reload whenever the live snapshot ticks.
  useEffect(() => {
    void load();
  }, [load, generatedAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!task) return null;
  const owner = agents.find((a) => a.id === task.ownerAgentId);

  async function patch(p: Parameters<typeof updateTaskAction>[1]) {
    await updateTaskAction(taskId, p);
    await refresh();
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onMouseDown={onClose}>
      <aside
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={`Task: ${task.title}`}
      >
        <div className="border-b border-line px-6 pb-3 pt-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold leading-snug">{task.title}</h2>
            <button type="button" className="btn-ghost -mr-2 px-2" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-ink-faint">Owner</span>
            <div className="flex items-center gap-2">
              <OwnerPicker value={task.ownerAgentId} onChange={(id) => patch({ ownerAgentId: id })}>
                <AgentAvatar agent={owner} size={26} />
              </OwnerPicker>
              <span>{owner?.name ?? "Unassigned"}</span>
              {owner && <ProviderTag provider={owner.provider} />}
              {owner && <span className="font-mono text-xs text-ink-soft">{owner.model}</span>}
            </div>
            <span className="text-ink-faint">Status</span>
            <ColorPicker<Column> className="w-40 overflow-hidden rounded" value={task.column} options={COLUMN_META} onChange={(c) => patch({ column: c })} />
            <span className="text-ink-faint">Priority</span>
            <ColorPicker<Priority> className="w-40 overflow-hidden rounded" value={task.priority} options={PRIORITY_META} onChange={(p) => patch({ priority: p })} />
            <span className="text-ink-faint">Progress</span>
            <div className="max-w-xs"><ProgressBar pct={task.progressPct} color={COLUMN_META[task.column].color} /></div>
          </div>
          <div role="tablist" className="mt-4 flex gap-1">
            {(["updates", "activity", "files", "details"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`border-b-2 px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? "border-brand" : "border-transparent text-ink-soft hover:text-ink"}`}
              >
                {t === "updates"
                  ? `Updates (${detail.messages.length})`
                  : t === "activity"
                    ? `Activity (${detail.events.length})`
                    : t === "files"
                      ? `Files (${new Set(detail.artifacts.map((a) => a.path)).size})`
                      : "Details"}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-6 py-4">
          {tab === "updates" && <Updates taskId={taskId} ownerId={task.ownerAgentId} messages={detail.messages} onSent={load} />}
          {tab === "activity" && <Activity events={detail.events} />}
          {tab === "files" && <ArtifactsList artifacts={detail.artifacts} onChange={load} />}
          {tab === "details" && <Details taskId={taskId} />}
        </div>
      </aside>
    </div>
  );
}

function Updates({
  taskId,
  ownerId,
  messages,
  onSent,
}: {
  taskId: string;
  ownerId: string | null;
  messages: Message[];
  onSent: () => Promise<void>;
}) {
  const { agents } = useLive();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const name = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.name ?? "Unknown agent") : "You");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    await sendMessageAction({ text, taskId, toAgentId: ownerId });
    setText("");
    setSending(false);
    await onSent();
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={send} className="card p-3">
        <label htmlFor="drawer-msg" className="sr-only">Write an update</label>
        <textarea
          id="drawer-msg"
          className="input min-h-16 border-0 p-0 focus:ring-0"
          placeholder={ownerId ? `Write an update or instruction for ${name(ownerId)}…` : "Write an update…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <button type="submit" className="btn-primary" disabled={sending || !text.trim()}>Update</button>
        </div>
      </form>
      {!messages.length && <p className="py-6 text-center text-sm text-ink-soft">No updates on this task yet. Agents post here when they talk about it.</p>}
      {[...messages].reverse().map((m) => {
        const from = agents.find((a) => a.id === m.fromAgentId);
        return (
          <article key={m.id} className="card p-4">
            <header className="mb-2 flex items-center gap-2 text-sm">
              {m.fromAgentId ? <AgentAvatar agent={from} size={26} /> : <UserAvatar size={26} />}
              <span className="font-medium">{name(m.fromAgentId)}</span>
              {m.toAgentId && <span className="text-ink-faint">→ {name(m.toAgentId)}</span>}
              <time className="ml-auto text-xs text-ink-faint">{timeAgo(m.at)}</time>
            </header>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>
          </article>
        );
      })}
    </div>
  );
}

export function Activity({ events }: { events: AgentEvent[] }) {
  const { agents } = useLive();
  if (!events.length) return <p className="py-6 text-center text-sm text-ink-soft">No activity recorded yet.</p>;
  return (
    <ol className="relative flex flex-col gap-3 border-l border-line pl-5">
      {events.map((e) => {
        const d = describeEvent(e);
        const agent = agents.find((a) => a.id === e.agentId);
        return (
          <li key={e.id} className="relative">
            <span className={`absolute -left-[29px] grid h-4 w-4 place-items-center rounded-full bg-white text-[10px] ring-1 ring-line ${d.tone === "error" ? "text-[#d83a52]" : "text-ink-soft"}`}>
              {d.icon}
            </span>
            <p className={`text-sm ${d.tone === "error" ? "text-[#d83a52]" : ""}`}>{d.text}</p>
            {d.detail && <pre className="mt-1 max-h-32 overflow-auto rounded bg-white p-2 font-mono text-[11px] text-ink-soft ring-1 ring-line">{d.detail}</pre>}
            <p className="text-xs text-ink-faint">
              {agent?.name ?? (e.agentId ? "Agent" : "You")} · {timeAgo(e.at)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Details({ taskId }: { taskId: string }) {
  const { tasks, refresh } = useLive();
  const task = tasks.find((t) => t.id === taskId)!;
  const [description, setDescription] = useState(task.description);
  const [acceptance, setAcceptance] = useState(task.acceptanceCriteria);
  const [saved, setSaved] = useState(false);
  const dirty = description !== task.description || acceptance !== task.acceptanceCriteria;
  const parent = task.parentTaskId ? tasks.find((t) => t.id === task.parentTaskId) : null;
  const deps = task.dependsOn.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);

  async function save() {
    await updateTaskAction(taskId, { description, acceptanceCriteria: acceptance });
    await refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="td-desc">Description</label>
        <textarea id="td-desc" className="input min-h-28" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="td-acc">Done when</label>
        <textarea id="td-acc" className="input min-h-16" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
      </div>
      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-sm text-[#00a35c]">Saved</span>}
        <button type="button" className="btn-primary" disabled={!dirty} onClick={save}>Save</button>
      </div>
      <dl className="card grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm">
        <dt className="text-ink-faint">Budget</dt>
        <dd>{task.budgetUsd != null ? usd(task.budgetUsd) : "No limit"}</dd>
        <dt className="text-ink-faint">Created by</dt>
        <dd>{task.createdBy === "user" ? "You" : task.createdBy}</dd>
        <dt className="text-ink-faint">Created</dt>
        <dd>{timeAgo(task.createdAt)}</dd>
        {parent && (
          <>
            <dt className="text-ink-faint">Part of</dt>
            <dd>{parent.title}</dd>
          </>
        )}
        {deps.length > 0 && (
          <>
            <dt className="text-ink-faint">Waits for</dt>
            <dd>{deps.map((d) => d!.title).join(", ")}</dd>
          </>
        )}
        <dt className="text-ink-faint">Task id</dt>
        <dd className="font-mono text-xs">{task.id}</dd>
      </dl>
    </div>
  );
}
