"use client";

import { useEffect, useState } from "react";
import { createTaskAction } from "@/app/actions";
import { COLUMN_META, PRIORITY_META } from "@/lib/format";
import { COLUMNS, PRIORITIES, type Column, type Priority } from "@/lib/schema";
import { useLive } from "../live";
import { Modal } from "../ui";

export function NewTaskDialog({ onClose, projectId: initialProject = "" }: { onClose: () => void; projectId?: string }) {
  const { agents, projects, refresh } = useLive();
  const [projectId, setProjectId] = useState(initialProject);
  // A project created a moment ago may not be in the live data yet.
  useEffect(() => {
    if (initialProject && !projects.some((p) => p.id === initialProject)) void refresh();
  }, [initialProject, projects, refresh]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [owner, setOwner] = useState<string>("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [column, setColumn] = useState<Column | "">("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setErr("Give the task a title.");
    setSaving(true);
    try {
      await createTaskAction({
        title,
        description,
        acceptanceCriteria: acceptance,
        ownerAgentId: owner || null,
        priority,
        column: column || undefined,
        budgetUsd: budget ? Number(budget) : null,
        projectId: projectId || null,
      });
      await refresh();
      onClose();
    } catch {
      setErr("Could not create the task. Check the fields and try again.");
      setSaving(false);
    }
  }

  return (
    <Modal title="New task" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="nt-title">Title</label>
          <input id="nt-title" className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add rate limiting to the public API" />
        </div>
        <div>
          <label className="label" htmlFor="nt-desc">What should the agent do?</label>
          <textarea id="nt-desc" className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="nt-acc">Done when</label>
          <textarea id="nt-acc" className="input min-h-14" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} placeholder="Tests pass, 429 returned after 100 req/min" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label" htmlFor="nt-project">Project</label>
            <select id="nt-project" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.filter((p) => p.status !== "done").map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-owner">Assign to</label>
            <select id="nt-owner" className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Unassigned (any agent can claim it)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {a.model}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-priority">Priority</label>
            <select id="nt-priority" className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-col">Status</label>
            <select id="nt-col" className="input" value={column} onChange={(e) => setColumn(e.target.value as Column | "")}>
              <option value="">Automatic (Ready if assigned)</option>
              {COLUMNS.map((c) => <option key={c} value={c}>{COLUMN_META[c].label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-budget">Budget (USD, optional)</label>
            <input id="nt-budget" className="input" type="number" min="0" step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
        {err && <p className="text-sm text-[#d83a52]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Creating…" : "Create task"}</button>
        </div>
      </form>
    </Modal>
  );
}
