"use client";

import { useEffect, useState } from "react";
import { setArtifactStatusAction } from "@/app/actions";
import { ARTIFACT_STATUS_META, bytes, timeAgo } from "@/lib/format";
import type { ArtifactInfo } from "@/lib/schema";
import { useLive } from "./live";
import { ColorPicker } from "./ui";

const KIND_ICON: Record<ArtifactInfo["kind"], string> = {
  code: "</>",
  document: "¶",
  image: "▣",
  pdf: "PDF",
  data: "{ }",
  website: "◎",
  other: "•",
};

type Status = ArtifactInfo["status"];

/** Files agents saved, one row per file with its older versions folded under it. */
export function ArtifactsList({ artifacts, showTask = false, onChange }: { artifacts: ArtifactInfo[]; showTask?: boolean; onChange?: () => void }) {
  const { agents, tasks } = useLive();
  const groups = new Map<string, ArtifactInfo[]>();
  for (const a of artifacts) {
    const key = `${a.taskId}\u0000${a.path}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  if (!groups.size) {
    return (
      <p className="py-6 text-center text-sm text-ink-soft">
        No files yet. Agents save their results here with save_artifact.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {[...groups.values()].map((versions) => {
        const sorted = [...versions].sort((x, y) => y.version - x.version);
        const latest = sorted[0];
        return (
          <ArtifactRow
            key={latest.id}
            latest={latest}
            older={sorted.slice(1)}
            agentName={agents.find((a) => a.id === latest.agentId)?.name ?? (latest.agentId ? "Agent" : "You")}
            taskTitle={showTask ? tasks.find((t) => t.id === latest.taskId)?.title : undefined}
            onChange={onChange}
          />
        );
      })}
    </ul>
  );
}

function ArtifactRow({
  latest,
  older,
  agentName,
  taskTitle,
  onChange,
}: {
  latest: ArtifactInfo;
  older: ArtifactInfo[];
  agentName: string;
  taskTitle?: string;
  onChange?: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<Status>(latest.status);
  const href = `/api/ui/artifacts/${latest.id}`;
  return (
    <li className="card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-8 w-10 shrink-0 place-items-center rounded bg-canvas font-mono text-[11px] text-ink-soft">{KIND_ICON[latest.kind]}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-medium">{latest.path}</p>
          <p className="truncate text-xs text-ink-faint">
            v{latest.version} · {bytes(latest.sizeBytes)} · {agentName} · {timeAgo(latest.createdAt)}
            {taskTitle && <> · {taskTitle}</>}
          </p>
          {latest.note && <p className="mt-0.5 text-xs text-ink-soft">{latest.note}</p>}
        </div>
        <ColorPicker<Status>
          className="w-28 overflow-hidden rounded"
          value={status}
          options={ARTIFACT_STATUS_META}
          onChange={async (s) => {
            setStatus(s);
            await setArtifactStatusAction(latest.id, s);
            onChange?.();
          }}
        />
        <div className="flex gap-1">
          {previewable(latest) && (
            <button type="button" className="btn-ghost px-2 text-sm" onClick={() => setPreview((p) => !p)} aria-expanded={preview}>
              {preview ? "Hide" : "Preview"}
            </button>
          )}
          <a className="btn-ghost px-2 text-sm" href={href} target="_blank" rel="noreferrer">Open</a>
          <a className="btn-ghost px-2 text-sm" href={`${href}?download=1`}>Download</a>
        </div>
      </div>
      {preview && <Preview artifact={latest} href={href} />}
      {older.length > 0 && (
        <details className="mt-2 text-xs text-ink-soft">
          <summary className="cursor-pointer">{older.length} older version{older.length === 1 ? "" : "s"}</summary>
          <ul className="mt-1 flex flex-col gap-1 pl-4">
            {older.map((v) => (
              <li key={v.id} className="flex gap-2">
                <span>v{v.version} · {bytes(v.sizeBytes)} · {timeAgo(v.createdAt)}</span>
                <a className="text-brand hover:underline" href={`/api/ui/artifacts/${v.id}`} target="_blank" rel="noreferrer">Open</a>
                <a className="text-brand hover:underline" href={`/api/ui/artifacts/${v.id}?download=1`}>Download</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function previewable(a: ArtifactInfo): boolean {
  return a.kind === "image" || a.kind === "website" || isText(a);
}

function isText(a: ArtifactInfo): boolean {
  return a.mimeType.startsWith("text/") || a.mimeType === "application/json" || a.mimeType === "application/xml";
}

function Preview({ artifact, href }: { artifact: ArtifactInfo; href: string }) {
  if (artifact.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={href} alt={artifact.path} className="mt-3 max-h-96 rounded ring-1 ring-line" />;
  }
  if (artifact.kind === "website") {
    // The file route also sends a CSP sandbox, so the page can't reach the dashboard.
    return <iframe src={href} title={artifact.path} sandbox="allow-scripts allow-forms" className="mt-3 h-96 w-full rounded bg-white ring-1 ring-line" />;
  }
  return <TextPreview href={href} />;
}

function TextPreview({ href }: { href: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(href)
      .then((r) => r.text())
      .then((t) => live && setText(t.length > 100_000 ? `${t.slice(0, 100_000)}\n…` : t))
      .catch(() => live && setText("Could not load the file."));
    return () => {
      live = false;
    };
  }, [href]);
  return (
    <pre className="mt-3 max-h-96 overflow-auto rounded bg-canvas p-3 font-mono text-xs leading-relaxed">{text ?? "Loading…"}</pre>
  );
}
