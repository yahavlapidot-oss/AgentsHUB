"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteNoteAction, saveNoteAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";
import type { Note } from "@/lib/schema";

export function NotesView({ notes, names }: { notes: Note[]; names: Record<string, string> }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return setErr("Give the note a title and some text.");
    await saveNoteAction({ title, text });
    setTitle("");
    setText("");
    setErr(null);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="flex min-w-0 flex-col gap-3">
        {notes.length ? (
          notes.map((n) => (
            <article key={n.id} className="card p-4">
              <div className="flex items-start gap-3">
                <h2 className="min-w-0 flex-1 font-semibold">{n.title}</h2>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setTitle(n.title);
                    setText(n.text);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-danger text-xs"
                  onClick={async () => {
                    await deleteNoteAction(n.id);
                    router.refresh();
                  }}
                >
                  Delete
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{n.text}</p>
              <p className="mt-3 text-xs text-ink-faint">
                {n.authorAgentId ? names[n.authorAgentId] ?? "Removed agent" : "You"} · {timeAgo(n.updatedAt)}
              </p>
            </article>
          ))
        ) : (
          <div className="card p-8 text-center text-sm text-ink-soft">
            No notes yet. Agents add notes as they work, and you can add your own, like goals, rules or context the whole team should know.
          </div>
        )}
      </section>

      <form className="card flex flex-col gap-3 self-start p-4" onSubmit={save}>
        <h2 className="font-semibold">Add or update a note</h2>
        <div>
          <label className="label" htmlFor="note-title">Title</label>
          <input id="note-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coding conventions" />
        </div>
        <div>
          <label className="label" htmlFor="note-text">Note</label>
          <textarea id="note-text" className="input min-h-[140px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="TypeScript only. Every change needs a test." />
        </div>
        <p className="text-xs text-ink-faint">Saving with an existing title replaces that note.</p>
        {err && <p className="text-sm text-[#d83a52]">{err}</p>}
        <button type="submit" className="btn-primary self-end">Save note</button>
      </form>
    </div>
  );
}
