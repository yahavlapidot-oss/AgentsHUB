"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { sendToChiefAction, setChiefAction } from "@/app/actions";
import { AGENT_STATUS_META } from "@/lib/format";
import { HQ_CHANNEL } from "@/lib/hq";
import type { Priority, PublicAgent } from "@/lib/schema";
import { useLive } from "../live";
import { toast } from "../toast";
import { AgentAvatar } from "../ui";
import { Bubble, Composer, useProjectMessages } from "./project-chat";

const QUICK = ["What needs me today?", "How is everything going?", "What got done since yesterday?"];

/** HQ: the one chat with your chief of staff, above all projects. */
export function ChiefChat() {
  const { agents, tasks, approvals, chiefAgentId, refresh: refreshLive } = useLive();
  const chief = agents.find((a) => a.id === chiefAgentId) ?? null;
  const { messages, refresh } = useProjectMessages(HQ_CHANNEL);
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const shown = (messages?.length ?? 0) + (pending ? 1 : 0);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [shown]);

  async function pick(agentId: string) {
    try {
      await setChiefAction(agentId || null);
      await refreshLive();
      toast("Chief of staff saved");
    } catch {
      toast("Couldn't save. Try again.", "error");
    }
  }

  async function send(text: string, asTask: boolean, priority: Priority) {
    setPending(text);
    try {
      await sendToChiefAction({ text, asTask, priority });
      await Promise.all([refresh(), refreshLive()]);
      return true;
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Couldn't send. Try again.", "error");
      return false;
    } finally {
      setPending(null);
    }
  }

  const lastFromYou = [...(messages ?? [])].reverse().find((m) => !m.fromAgentId);
  const answered = chief && (messages ?? []).some((m) => m.fromAgentId === chief.id && lastFromYou && m.at > lastFromYou.at);
  const thinking = Boolean(chief && lastFromYou && !answered && chief.status === "active" && Date.now() - lastFromYou.at < 10 * 60_000);
  const hosted = agents.filter((a) => a.kind === "hosted");

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex items-center gap-3 border-b border-line bg-white px-3 py-2.5 sm:px-4">
        <Link href="/chat" className="btn-ghost -ml-1 px-2 md:hidden" aria-label="Back to chats">←</Link>
        <AgentAvatar agent={chief} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">HQ · chief of staff</p>
          <p className="truncate text-xs text-ink-soft">
            {chief ? (
              <>
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: AGENT_STATUS_META[chief.status].color }} />
                {chief.name} · {AGENT_STATUS_META[chief.status].label.toLowerCase()}
                {approvals.length > 0 && ` · ${approvals.length} approval${approvals.length === 1 ? "" : "s"} waiting`}
              </>
            ) : (
              "Pick the agent you'll talk to about everything"
            )}
          </p>
        </div>
        {chief && (
          <select className="input hidden w-36 py-1 text-xs sm:block" value={chief.id} onChange={(e) => void pick(e.target.value)} aria-label="Chief of staff">
            {hosted.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </header>

      {!chief ? (
        <PickChief agents={hosted} onPick={pick} />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
            {messages && !messages.length && !pending && (
              <div className="mx-auto max-w-sm py-10 text-center text-sm text-ink-soft">
                <p className="font-medium text-ink">Your chief of staff is ready</p>
                <p className="mt-1">
                  Ask for anything in one line, in any language. {chief.name} puts the work in the right project, hands it to the right agent, sets up recurring work, and tells you what needs you.
                </p>
              </div>
            )}
            <ol className="mx-auto flex max-w-3xl flex-col gap-2">
              {(messages ?? []).map((m) => (
                <Bubble key={m.id} m={m} lead={chief} agents={agents} tasks={tasks} />
              ))}
              {pending && (
                <li className="flex justify-end opacity-60">
                  <p dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3 py-2 text-sm text-white">{pending}</p>
                </li>
              )}
              {thinking && <li className="text-xs text-ink-soft">{chief.name} is on it…</li>}
            </ol>
            <div ref={endRef} />
          </div>
          <Composer leadName={chief.name} onSend={send} busy={Boolean(pending)} quick={QUICK} />
        </>
      )}
    </div>
  );
}

function PickChief({ agents, onPick }: { agents: PublicAgent[]; onPick: (id: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto p-4">
      <p className="font-semibold">Who is your chief of staff?</p>
      <p className="mt-1 text-sm text-ink-soft">
        One agent you talk to about everything. It sees every project, hands out work, sets up schedules and tells you what needs you. A strong model works best here.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {agents.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => onPick(a.id)} className="card flex w-full items-center gap-3 p-3 text-left hover:border-brand">
              <AgentAvatar agent={a} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{a.name}</span>
                <span className="block truncate text-xs text-ink-soft">{a.model} · {a.skills.join(", ") || "general"}</span>
              </span>
            </button>
          </li>
        ))}
        {!agents.length && (
          <li className="text-sm text-ink-soft">
            The chief of staff has to be an agent AgentsHUB runs. <Link href="/agents" className="text-brand underline">Add one</Link> (for example from the &ldquo;Chief of staff&rdquo; template).
          </li>
        )}
      </ul>
    </div>
  );
}
