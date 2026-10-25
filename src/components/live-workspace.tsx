"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { sendCommandAction } from "@/app/actions";
import type { LiveRun } from "@/lib/live-work";
import { AGENT_STATUS_META, compact, timeAgo, usd } from "@/lib/format";
import type { AgentEvent, PublicAgent } from "@/lib/schema";
import { describeEvent } from "./event-line";
import { AgentAvatar, EmptyState } from "./ui";

const POLL_MS = 2000;

type LiveData = { runs: LiveRun[]; idle: PublicAgent[]; generatedAt: number };

/** Every agent at work right now: its cloud computer, the commands it runs with their output, and controls to step in. */
export function LiveWorkspace({ initial }: { initial: LiveData }) {
  const [data, setData] = useState(initial);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/ui/live", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      {data.runs.length ? (
        data.runs.map((r) => <RunCard key={r.run.id} live={r} now={data.generatedAt} onChange={refresh} />)
      ) : (
        <EmptyState title="No agent is working right now" hint="When an agent picks up a task, its commands and output show up here as they happen." />
      )}
      {data.idle.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-soft">Not working on anything</h2>
          <ul className="flex flex-wrap gap-2">
            {data.idle.map((a) => (
              <li key={a.id}>
                <Link href={`/agents/${a.id}`} className="card flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-canvas">
                  <AgentAvatar agent={a} size={20} />
                  {a.name}
                  <span className="text-xs" style={{ color: AGENT_STATUS_META[a.status].color }}>{AGENT_STATUS_META[a.status].label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RunCard({ live, now, onChange }: { live: LiveRun; now: number; onChange: () => Promise<void> }) {
  const { run, agent, task, events, sandbox } = live;
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const paused = agent?.status === "paused";
  const cost = run.costUsd + (sandbox?.runningCostUsd ?? 0);

  async function command(type: "pause" | "resume" | "stop" | "redirect", text = "") {
    if (!agent) return;
    await sendCommandAction(agent.id, type, text);
    setSent(
      { pause: "Pausing after the current step", resume: "Resuming", stop: "Stopping after the current step", redirect: "Sent; the agent reads it after the current step" }[type],
    );
    await onChange();
  }

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <AgentAvatar agent={agent} size={28} />
          <div className="min-w-0">
            <p className="truncate font-semibold">
              {agent ? <Link href={`/agents/${agent.id}`} className="hover:underline">{agent.name}</Link> : "Removed agent"}
              <span className="ml-2 font-mono text-xs font-normal text-ink-faint">{run.model}</span>
            </p>
            <p className="truncate text-sm text-ink-soft">{task?.title ?? "No task (answering messages)"}</p>
          </div>
        </div>
        <dl className="flex w-full flex-wrap gap-x-4 gap-y-1 text-xs sm:w-auto">
          <Stat label="Started" value={timeAgo(run.startedAt, now)} />
          <Stat label="Tokens" value={compact(run.tokensIn + run.tokensOut)} />
          <Stat label="Cost so far" value={usd(cost)} />
          {task?.budgetUsd != null && <Stat label="Task budget" value={usd(task.budgetUsd)} />}
        </dl>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-4 py-2 text-xs text-ink-soft">
        <span className="h-2 w-2 rounded-full" style={{ background: sandbox ? "#00c875" : "#c4c4c4" }} />
        {sandbox ? (
          <span>
            Cloud computer {sandbox.status} · {sandbox.commands} command{sandbox.commands === 1 ? "" : "s"} · {usd(sandbox.runningCostUsd)} so far
          </span>
        ) : (
          <span>No cloud computer for this run</span>
        )}
        {paused && <span className="rounded bg-[#fdab3d]/20 px-1.5 py-0.5 font-medium text-[#b87100]">Paused</span>}
      </div>

      <Terminal events={events} />

      <footer className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-start">
        <div className="flex gap-2">
          {paused ? (
            <button type="button" className="btn-primary" onClick={() => command("resume")} disabled={!agent}>Resume</button>
          ) : (
            <button type="button" className="btn-ghost border border-line" onClick={() => command("pause")} disabled={!agent}>Pause</button>
          )}
          <button type="button" className="btn-danger border border-line" onClick={() => command("stop")} disabled={!agent}>Stop</button>
        </div>
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!note.trim()) return;
            await command("redirect", note.trim());
            setNote("");
          }}
        >
          <label className="sr-only" htmlFor={`steer-${run.id}`}>Tell the agent</label>
          <input
            id={`steer-${run.id}`}
            className="input min-w-0 flex-1"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Step in: e.g. skip the e2e tests, fix the lint error first"
          />
          <button type="submit" className="btn-primary" disabled={!note.trim() || !agent}>Send</button>
        </form>
      </footer>
      {sent && <p className="px-4 pb-3 text-xs text-ink-soft">{sent}.</p>}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

/** The run so far, oldest first, kept scrolled to the latest line unless you scroll up. */
function Terminal({ events }: { events: AgentEvent[] }) {
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const last = events.at(-1)?.id;

  useEffect(() => {
    if (follow.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [last]);

  return (
    <div
      ref={box}
      className="max-h-[28rem] min-h-32 overflow-y-auto bg-[#1f2130] px-4 py-3 font-mono text-xs leading-relaxed text-[#e6e8f0]"
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      aria-live="polite"
    >
      {events.length ? (
        events.map((e) => {
          const d = describeEvent(e);
          const command = d.text.startsWith("$ ");
          return (
            <div key={e.id} className="py-0.5">
              <p className={`whitespace-pre-wrap break-words ${d.tone === "error" ? "text-[#ff8a9a]" : command ? "text-[#7ee2a8]" : e.type === "note" ? "text-[#c3c6d6]" : ""}`}>
                <span className="mr-2 select-none text-[#7c8099]">{new Date(e.at).toLocaleTimeString("en-GB")}</span>
                {command ? d.text : `${d.icon} ${d.text}`}
              </p>
              {d.detail && <pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap break-words border-l-2 border-[#3a3e55] pl-3 text-[#aeb2c6]">{d.detail}</pre>}
            </div>
          );
        })
      ) : (
        <p className="text-[#7c8099]">Starting…</p>
      )}
    </div>
  );
}
