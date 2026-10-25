"use client";

import { useMemo, useState } from "react";
import { ARTIFACT_STATUS_META } from "@/lib/format";
import { ARTIFACT_STATUSES, type ArtifactInfo } from "@/lib/schema";
import { ArtifactsList } from "./artifacts-list";
import { useLive } from "./live";

const fileKey = (a: ArtifactInfo) => `${a.projectId ? `p:${a.projectId}` : `t:${a.taskId}`}\u0000${a.path}`;

/** The Files page: every file, narrowed by project, review status, who made it, or name. */
export function FilesBrowser({ artifacts }: { artifacts: ArtifactInfo[] }) {
  const { agents, projects } = useLive();
  const [project, setProject] = useState("all");
  const [status, setStatus] = useState("all");
  const [creator, setCreator] = useState("all");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    // Status and creator are those of a file's latest version, which is what you review.
    const latest = new Map<string, ArtifactInfo>();
    for (const a of artifacts) {
      const k = fileKey(a);
      const cur = latest.get(k);
      if (!cur || a.version > cur.version) latest.set(k, a);
    }
    const q = query.trim().toLowerCase();
    return artifacts.filter((a) => {
      const l = latest.get(fileKey(a))!;
      if (project !== "all" && (project === "none" ? l.projectId : l.projectId !== project)) return false;
      if (status !== "all" && l.status !== status) return false;
      if (creator !== "all" && (l.agentId ?? "you") !== creator) return false;
      return !q || l.path.toLowerCase().includes(q);
    });
  }, [artifacts, project, status, creator, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="ff-q">Search files</label>
        <input id="ff-q" className="input w-full sm:w-56" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select id="ff-project" label="Project" value={project} onChange={setProject}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="none">No project</option>
        </Select>
        <Select id="ff-status" label="Status" value={status} onChange={setStatus}>
          <option value="all">Any status</option>
          {ARTIFACT_STATUSES.map((s) => <option key={s} value={s}>{ARTIFACT_STATUS_META[s].label}</option>)}
        </Select>
        <Select id="ff-creator" label="Made by" value={creator} onChange={setCreator}>
          <option value="all">Anyone</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          <option value="you">You</option>
        </Select>
      </div>
      <ArtifactsList artifacts={shown} showTask showProject />
    </div>
  );
}

function Select({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </>
  );
}
