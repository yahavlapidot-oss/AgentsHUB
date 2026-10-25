"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { sendToLeadAction, setProjectLeadAction } from "@/app/actions";
import { AGENT_STATUS_META, COLUMN_META, PRIORITY_META, timeAgo } from "@/lib/format";
import { isProjectMember, projectLead } from "@/lib/project-lead";
import { PRIORITIES, type Message, type Priority, type PublicAgent, type Task } from "@/lib/schema";
import { useLive } from "../live";
import { toast } from "../toast";
import { AgentAvatar, ProgressBar } from "../ui";

const POLL_MS = 3000;
const QUICK = ["What's the status?", "What's blocked or waiting on me?", "Summarize today's work"];

/** Polls the project chat's messages, answering 304 while nothing changed. */
function useProjectMessages(projectId: string) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const etag = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/ui/projects/${projectId}/chat`, { cache: "no-store", headers: etag.current ? { "if-none-match": etag.current } : {} });
      if (res.status === 304 || !res.ok) return;
      etag.current = res.headers.get("etag");
      setMessages((await res.json()).messages);
    } catch {
      // Offline for a moment: the next poll tries again.
    }
  }, [projectId]);

  useEffect(() => {
    etag.current = null;
    setMessages(null);
    void refresh();
    const id = setInterval(() => document.visibilityState === "visible" && void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { messages, refresh };
}

/** Chat with the project's work manager, and hand it tasks in one line. */
export function ProjectChat({ projectId }: { projectId: string }) {
  const { projects, agents, tasks, refresh: refreshLive } = useLive();
  const project = projects.find((p) => p.id === projectId);
  const { messages, refresh } = useProjectMessages(projectId);
  const [pending, setPending] = useState<{ text: string; asTask: boolean } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const shownCount = (messages?.length ?? 0) + (pending ? 1 : 0);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [shownCount]);

  if (!project) {
    return (
      <div className="grid h-full place-items-center p-8 text-center text-sm text-ink-soft">
        <div>
          <p>This project doesn&apos;t exist anymore.</p>
          <Link href="/chat" className="mt-2 inline-block text-brand underline">Back to chats</Link>
        </div>
      </div>
    );
  }

  const lead = projectLead(project, agents);
  const candidates = agents.filter((a) => isProjectMember(project, a.id));

  async function send(text: string, asTask: boolean, priority: Priority) {
    setPending({ text, asTask });
    try {
      await sendToLeadAction(projectId, { text, asTask, priority });
      if (asTask) toast(`Task sent to ${lead?.name ?? "the work manager"}`);
      await Promise.all([refresh(), refreshLive()]);
      return true;
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Couldn't send. Try again.", "error");
      return false;
    } finally {
      setPending(null);
    }
  }

  async function pickLead(agentId: string) {
    try {
      await setProjectLeadAction(projectId, agentId || null);
      await refreshLive();
      toast("Work manager saved");
    } catch {
      toast("Couldn't save the work manager.", "error");
    }
  }

  const lastFromYou = [...(messages ?? [])].reverse().find((m) => !m.fromAgentId);
  const answered = lead && (messages ?? []).some((m) => m.fromAgentId === lead.id && lastFromYou && m.at > lastFromYou.at);
  const thinking = Boolean(lead && lastFromYou && !answered && lead.status === "active" && Date.now() - lastFromYou.at < 10 * 60_000);
  const leadTask = lead?.currentTaskId ? tasks.find((t) => t.id === lead.currentTaskId) : undefined;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b border-line bg-white px-3 py-2.5 sm:px-4">
        <Link href="/chat" className="btn-ghost -ml-1 px-2 md:hidden" aria-label="Back to chats">←</Link>
        <AgentAvatar agent={lead} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{project.name}</p>
          <p className="truncate text-xs text-ink-soft">
            {lead ? (
              <>
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: AGENT_STATUS_META[lead.status].color }} />
                {lead.name} · {leadTask ? `working on "${leadTask.title}"` : AGENT_STATUS_META[lead.status].label.toLowerCase()}
              </>
            ) : (
              "No work manager yet"
            )}
          </p>
        </div>
        {lead && (
          <label className="hidden items-center gap-1 text-xs text-ink-soft sm:flex">
            <span className="sr-only">Work manager</span>
            <select className="input w-36 py-1 text-xs" value={project.leadAgentId ?? ""} onChange={(e) => void pickLead(e.target.value)} aria-label="Work manager">
              {!project.leadAgentId && <option value="">{lead.name} (team lead)</option>}
              {candidates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <Link href={`/projects/${project.id}`} className="btn-ghost shrink-0 px-2 text-xs">Project</Link>
      </header>

      {!lead ? (
        <PickLead agents={candidates} onPick={pickLead} />
      ) : (
        <>
          {(lead.status === "offline" || lead.status === "paused") && (
            <p className="border-b border-line bg-[#fff6e5] px-4 py-2 text-xs text-[#8a5a00]">
              {lead.name} is {lead.status}. It reads your messages and tasks when it&apos;s back.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
            {messages && !messages.length && !pending && (
              <div className="mx-auto max-w-sm py-10 text-center text-sm text-ink-soft">
                <p className="font-medium text-ink">Say hi to {lead.name}</p>
                <p className="mt-1">Ask how the project is going, or switch to Task and describe what you need in a line. {lead.name} splits it and hands the pieces to the team.</p>
              </div>
            )}
            <ol className="mx-auto flex max-w-3xl flex-col gap-2">
              {(messages ?? []).map((m) => (
                <Bubble key={m.id} m={m} lead={lead} agents={agents} tasks={tasks} />
              ))}
              {pending && (
                <li className="flex justify-end opacity-60">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-white">{pending.text}</p>
                </li>
              )}
              {thinking && (
                <li className="flex items-center gap-2 text-xs text-ink-soft">
                  <span className="flex gap-0.5" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </span>
                  {lead.name} is on it
                </li>
              )}
            </ol>
            <div ref={endRef} />
          </div>
          <Composer leadName={lead.name} onSend={send} busy={Boolean(pending)} />
        </>
      )}
    </div>
  );
}

function PickLead({ agents, onPick }: { agents: PublicAgent[]; onPick: (id: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto p-4">
      <p className="font-semibold">Who runs this project?</p>
      <p className="mt-1 text-sm text-ink-soft">
        Pick the agent you&apos;ll talk to here. It plans the work you send, hands pieces to the other agents and tells you how it&apos;s going.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {agents.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => onPick(a.id)} className="card flex w-full items-center gap-3 p-3 text-left hover:border-brand">
              <AgentAvatar agent={a} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{a.name}</span>
                <span className="block truncate text-xs text-ink-soft">
                  {a.model} · {a.skills.join(", ") || "general"}
                  {a.kind !== "hosted" && " · runs outside AgentsHUB"}
                </span>
              </span>
              {a.role === "lead" && <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] text-brand">team lead</span>}
            </button>
          </li>
        ))}
        {!agents.length && (
          <li className="text-sm text-ink-soft">
            No agents can work on this project. <Link href="/agents" className="text-brand underline">Add an agent</Link> first.
          </li>
        )}
      </ul>
    </div>
  );
}

function Bubble({ m, lead, agents, tasks }: { m: Message; lead: PublicAgent; agents: PublicAgent[]; tasks: Task[] }) {
  const task = m.taskId ? tasks.find((t) => t.id === m.taskId) : undefined;
  if (!m.fromAgentId) {
    return (
      <li className="flex flex-col items-end gap-1">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-white">{m.text}</p>
        {task && <TaskCard task={task} tasks={tasks} agents={agents} />}
        <time className="text-[11px] text-ink-faint">{timeAgo(m.at)}</time>
      </li>
    );
  }
  const from = agents.find((a) => a.id === m.fromAgentId);
  // Other agents talking in the project show smaller, so the conversation with the manager stays readable.
  if (m.fromAgentId !== lead.id) {
    const to = m.toAgentId ? agents.find((a) => a.id === m.toAgentId)?.name ?? "an agent" : "everyone";
    return (
      <li className="flex items-start gap-2 px-1 py-1 text-xs text-ink-soft">
        <AgentAvatar agent={from} size={18} />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          <span className="font-medium text-ink">{from?.name ?? "Agent"}</span> → {to}: {m.text}
          <time className="ml-1 text-ink-faint">{timeAgo(m.at)}</time>
        </p>
      </li>
    );
  }
  return (
    <li className="flex items-end gap-2">
      <AgentAvatar agent={from} size={26} />
      <div className="flex max-w-[85%] flex-col items-start gap-1">
        <p className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-line bg-white px-3 py-2 text-sm">{m.text}</p>
        {task && <TaskCard task={task} tasks={tasks} agents={agents} />}
        <time className="text-[11px] text-ink-faint">{timeAgo(m.at)}</time>
      </div>
    </li>
  );
}

/** A task the chat created, kept live: where it is, who has it and how far along it is. */
function TaskCard({ task, tasks, agents }: { task: Task; tasks: Task[]; agents: PublicAgent[] }) {
  const owner = agents.find((a) => a.id === task.ownerAgentId);
  const subtasks = tasks.filter((t) => t.parentTaskId === task.id);
  const doneSubs = subtasks.filter((t) => t.column === "done" || t.column === "review").length;
  const col = COLUMN_META[task.column];
  return (
    <div className="card w-72 max-w-full p-3 text-left text-ink">
      <p className="flex items-start gap-2 text-sm font-medium">
        <span className="mt-0.5 text-ink-faint" aria-hidden>▦</span>
        <span className="min-w-0 flex-1 break-words">{task.title}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded px-1.5 py-0.5 font-medium" style={{ background: col.color, color: col.text }}>{col.label}</span>
        {task.priority !== "medium" && (
          <span className="rounded px-1.5 py-0.5 font-medium" style={{ background: PRIORITY_META[task.priority].color, color: PRIORITY_META[task.priority].text }}>
            {PRIORITY_META[task.priority].label}
          </span>
        )}
        <span className="flex items-center gap-1 text-ink-soft">
          <AgentAvatar agent={owner} size={14} /> {owner?.name ?? "Unassigned"}
        </span>
      </div>
      <div className="mt-2"><ProgressBar pct={task.progressPct} color={col.color} /></div>
      {subtasks.length > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-soft">
          {doneSubs}/{subtasks.length} subtasks done · {[...new Set(subtasks.map((s) => agents.find((a) => a.id === s.ownerAgentId)?.name).filter(Boolean))].join(", ")}
        </p>
      )}
    </div>
  );
}

function Composer({ leadName, onSend, busy }: { leadName: string; onSend: (text: string, asTask: boolean, priority: Priority) => Promise<boolean>; busy: boolean }) {
  const [text, setText] = useState("");
  const [asTask, setAsTask] = useState(false);
  const [priority, setPriority] = useState<Priority>("medium");
  const box = useRef<HTMLTextAreaElement>(null);

  // Grows with the text up to a few lines, like a messaging app.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  async function submit(value = text, task = asTask) {
    const v = value.trim();
    if (!v || busy) return;
    setText("");
    const ok = await onSend(v, task, priority);
    if (!ok) setText(v);
    else if (task) {
      setAsTask(false);
      setPriority("medium");
    }
  }

  return (
    <div className="border-t border-line bg-white px-3 pb-3 pt-2 sm:px-4">
      {!text && !asTask && (
        <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => void submit(q, false)} disabled={busy} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-ink-soft hover:border-brand hover:text-brand">
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="mb-2 flex items-center gap-2">
        <div className="inline-flex rounded-md bg-canvas p-0.5 text-xs" role="radiogroup" aria-label="Send as">
          {[
            [false, "Message"],
            [true, "Task"],
          ].map(([v, label]) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={asTask === v}
              onClick={() => setAsTask(v as boolean)}
              className={`rounded px-3 py-1 font-medium ${asTask === v ? "bg-white text-ink shadow-sm" : "text-ink-soft"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {asTask && (
          <select className="input w-28 py-1 text-xs" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} aria-label="Priority">
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
          </select>
        )}
        {asTask && <span className="hidden text-xs text-ink-faint sm:inline">First line is the title. {leadName} hands it out.</span>}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="lead-chat-text">{asTask ? "Task" : "Message"}</label>
        <textarea
          id="lead-chat-text"
          ref={box}
          rows={1}
          className="input max-h-40 flex-1 resize-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends on a keyboard; phones keep Enter for new lines and use the button.
            if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={asTask ? "e.g. Add a pricing page with three plans" : `Message ${leadName}`}
        />
        <button type="submit" className="btn-primary" disabled={!text.trim() || busy}>{asTask ? "Add task" : "Send"}</button>
      </form>
    </div>
  );
}
