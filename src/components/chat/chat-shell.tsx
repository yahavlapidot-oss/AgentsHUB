"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AGENT_STATUS_META, timeAgo } from "@/lib/format";
import { HQ_CHANNEL } from "@/lib/hq";
import { projectLead } from "@/lib/project-lead";
import { useLive } from "../live";
import { AgentAvatar } from "../ui";

/**
 * Chats: one per project, with the agent who runs it, plus the team chat.
 * Phones show the list or one chat; wider screens show both side by side.
 */
export function ChatShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const atList = path === "/chat";
  return (
    <div className="flex h-[calc(100dvh-6.75rem-env(safe-area-inset-bottom))] sm:h-dvh">
      <aside className={`w-full shrink-0 flex-col border-r border-line bg-white md:flex md:w-80 ${atList ? "flex" : "hidden"}`}>
        <ChatList path={path} />
      </aside>
      <section className={`min-w-0 flex-1 flex-col ${atList ? "hidden md:flex" : "flex"}`}>{children}</section>
    </div>
  );
}

function ChatList({ path }: { path: string }) {
  const { projects, agents, tasks, messages, chiefAgentId } = useLive();
  const order = { active: 0, paused: 1, done: 2 } as const;
  const rows = projects
    .map((p) => {
      const last = messages.filter((m) => m.projectId === p.id).at(-1);
      return { p, lead: projectLead(p, agents), last, open: tasks.filter((t) => t.projectId === p.id && t.column !== "done").length };
    })
    .sort((a, b) => order[a.p.status] - order[b.p.status] || (b.last?.at ?? b.p.updatedAt) - (a.last?.at ?? a.p.updatedAt));
  const teamLast = messages.filter((m) => m.projectId !== HQ_CHANNEL).at(-1);
  const hqLast = messages.filter((m) => m.projectId === HQ_CHANNEL).at(-1);
  const chief = agents.find((a) => a.id === chiefAgentId) ?? null;
  const name = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? "Agent" : "You");

  return (
    <>
      <header className="border-b border-line px-4 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Chats</h1>
        <p className="mt-0.5 text-sm text-ink-soft">Each project&apos;s work manager. Ask for status or hand out tasks.</p>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        <li>
          <Link
            href="/chat/hq"
            className={`flex items-center gap-3 border-b border-line px-4 py-3 ${path === "/chat/hq" ? "bg-brand-soft" : "hover:bg-canvas active:bg-canvas"}`}
          >
            {chief ? <AgentAvatar agent={chief} size={42} /> : <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-brand text-lg text-white">★</span>}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-semibold">HQ · chief of staff</span>
                {hqLast && <time className="ml-auto shrink-0 text-xs text-ink-faint">{timeAgo(hqLast.at)}</time>}
              </span>
              <span className="block truncate text-sm text-ink-soft" dir="auto">
                {hqLast ? `${name(hqLast.fromAgentId)}: ${hqLast.text}` : chief ? `${chief.name}: one chat for everything` : "Pick one agent to talk to about everything"}
              </span>
            </span>
          </Link>
        </li>
        {rows.map(({ p, lead, last, open }) => (
          <li key={p.id}>
            <Link
              href={`/chat/${p.id}`}
              className={`flex items-center gap-3 border-b border-line px-4 py-3 ${path === `/chat/${p.id}` ? "bg-brand-soft" : "hover:bg-canvas active:bg-canvas"}`}
            >
              <span className="relative">
                <AgentAvatar agent={lead} size={42} />
                {lead && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white"
                    style={{ background: AGENT_STATUS_META[lead.status].color }}
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-semibold">{p.name}</span>
                  {last && <time className="ml-auto shrink-0 text-xs text-ink-faint">{timeAgo(last.at)}</time>}
                </span>
                <span className="block truncate text-sm text-ink-soft">
                  {last ? `${name(last.fromAgentId)}: ${last.text}` : lead ? `Work manager: ${lead.name}` : "No work manager yet"}
                </span>
              </span>
              {open > 0 && (
                <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-soft" title={`${open} open tasks`}>
                  {open}
                </span>
              )}
            </Link>
          </li>
        ))}
        {!rows.length && (
          <li className="px-4 py-6 text-sm text-ink-soft">
            No projects yet. <Link href="/projects" className="text-brand underline">Create one</Link> and pick its work manager.
          </li>
        )}
        <li>
          <Link
            href="/chat/team"
            className={`flex items-center gap-3 border-b border-line px-4 py-3 ${path === "/chat/team" ? "bg-brand-soft" : "hover:bg-canvas active:bg-canvas"}`}
          >
            <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-canvas text-lg text-ink-soft">#</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-semibold">Team chat</span>
                {teamLast && <time className="ml-auto shrink-0 text-xs text-ink-faint">{timeAgo(teamLast.at)}</time>}
              </span>
              <span className="block truncate text-sm text-ink-soft">Everything your agents say to each other</span>
            </span>
          </Link>
        </li>
      </ul>
    </>
  );
}
