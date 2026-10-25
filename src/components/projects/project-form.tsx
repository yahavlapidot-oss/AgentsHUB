"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProjectAction, deleteProjectAction, updateProjectAction } from "@/app/actions";
import { PROJECT_STATUS_LABELS as STATUS_LABELS } from "@/lib/format";
import { PROJECT_STATUSES, type Project, type PublicAgent } from "@/lib/schema";


/** Create a project, or edit one: name, goal, requirements, who may work on it, status. */
export function ProjectForm({ project, agents, onDone }: { project?: Project; agents: PublicAgent[]; onDone?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(project?.name ?? "");
  const [goal, setGoal] = useState(project?.goal ?? "");
  const [context, setContext] = useState(project?.context ?? "");
  const [members, setMembers] = useState<string[]>(project?.memberAgentIds ?? []);
  const [status, setStatus] = useState<Project["status"]>(project?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr("Give the project a name.");
    setSaving(true);
    const input = { name, goal, context, memberAgentIds: members, status };
    try {
      if (project) {
        await updateProjectAction(project.id, input);
      } else {
        const { id } = await createProjectAction(input);
        router.push(`/projects/${id}`);
      }
      setErr(null);
      onDone?.();
      router.refresh();
    } catch {
      setErr("Could not save the project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card flex flex-col gap-3 p-4" onSubmit={save}>
      <h2 className="font-semibold">{project ? "Project settings" : "New project"}</h2>
      <div>
        <label className="label" htmlFor="pf-name">Name</label>
        <input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer portal" />
      </div>
      <div>
        <label className="label" htmlFor="pf-goal">Goal</label>
        <textarea id="pf-goal" className="input min-h-16" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="A portal where customers see their invoices and pay online" />
      </div>
      <div>
        <label className="label" htmlFor="pf-context">Requirements and decisions</label>
        <textarea
          id="pf-context"
          className="input min-h-24"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Next.js and TypeScript. No new paid services without asking. Tests for every change."
        />
        <p className="mt-1 text-xs text-ink-faint">Every agent working on this project reads the goal and this text first.</p>
      </div>
      <fieldset>
        <legend className="label">Who may work on it</legend>
        <p className="mb-1 text-xs text-ink-faint">Only these agents take its tasks and change its files. None checked means every agent.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {agents.map((a) => (
            <label key={a.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={members.includes(a.id)}
                onChange={(e) => setMembers((m) => (e.target.checked ? [...m, a.id] : m.filter((x) => x !== a.id)))}
              />
              {a.name}
            </label>
          ))}
          {!agents.length && <span className="text-sm text-ink-soft">No agents yet.</span>}
        </div>
      </fieldset>
      {project && (
        <div>
          <label className="label" htmlFor="pf-status">Status</label>
          <select id="pf-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as Project["status"])}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <p className="mt-1 text-xs text-ink-faint">Agents don't take tasks of a paused or done project.</p>
        </div>
      )}
      {err && <p className="text-sm text-[#d83a52]">{err}</p>}
      <div className="flex items-center justify-between gap-2">
        {project ? (
          <button
            type="button"
            className="btn-danger text-xs"
            onClick={async () => {
              await deleteProjectAction(project.id);
              router.push("/projects");
              router.refresh();
            }}
          >
            Delete project
          </button>
        ) : <span />}
        <button type="submit" className="btn-primary" disabled={saving}>{project ? "Save" : "Create project"}</button>
      </div>
    </form>
  );
}
