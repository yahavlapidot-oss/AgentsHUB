"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAgentMemoryAction, saveAgentMemoryAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";
import type { AgentMemory } from "@/lib/schema";

/** What this agent remembers for itself, with a way to correct it or teach it something. */
export function AgentMemoryCard({ agentId, memories }: { agentId: string; memories: AgentMemory[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return setErr("Give it a title and some text.");
    await saveAgentMemoryAction(agentId, { title, text });
    setTitle("");
    setText("");
    setErr(null);
    setOpen(false);
    router.refresh();
  }

  return (
    <section className="card">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="flex-1 font-semibold">Memory</h2>
        <button type="button" className="btn-ghost text-xs" onClick={() => setOpen((o) => !o)}>
          {open ? "Cancel" : "Teach it something"}
        </button>
      </div>
      <p className="px-4 pt-3 text-sm text-ink-soft">
        What this agent remembers between tasks: your preferences, its conventions, lessons from mistakes. Only this agent reads it.
        Things the whole team should know belong in Team notes.
      </p>
      {open && (
        <form className="flex flex-col gap-2 px-4 pt-3" onSubmit={save}>
          <input className="input" aria-label="Memory title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Always write tests" />
          <textarea className="input min-h-[90px]" aria-label="Memory text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Every code change comes with tests that pass." />
          <p className="text-xs text-ink-faint">Saving with an existing title replaces it.</p>
          {err && <p className="text-sm text-[#d83a52]">{err}</p>}
          <button type="submit" className="btn-primary self-end">Save</button>
        </form>
      )}
      {memories.length ? (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {memories.map((m) => (
            <li key={m.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{m.title}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-ink-soft">{m.text}</p>
                <p className="mt-1 text-xs text-ink-faint">{timeAgo(m.updatedAt)}</p>
              </div>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setTitle(m.title);
                  setText(m.text);
                  setOpen(true);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn-danger text-xs"
                onClick={async () => {
                  await deleteAgentMemoryAction(agentId, m.id);
                  router.refresh();
                }}
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-ink-soft">Nothing yet. The agent saves things here as it learns.</p>
      )}
    </section>
  );
}
