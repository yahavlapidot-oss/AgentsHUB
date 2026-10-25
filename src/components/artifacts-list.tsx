"use client";

import { useEffect, useState } from "react";
import { diffArtifactsAction, setArtifactStatusAction } from "@/app/actions";
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
export function ArtifactsList({
  artifacts,
  showTask = false,
  showProject = false,
  onChange,
}: {
  artifacts: ArtifactInfo[];
  showTask?: boolean;
  showProject?: boolean;
  onChange?: () => void;
}) {
  const { agents, tasks, projects } = useLive();
  const nameOf = (agentId: string | null) => agents.find((a) => a.id === agentId)?.name ?? (agentId ? "Agent" : "You");
  const groups = new Map<string, ArtifactInfo[]>();
  for (const a of artifacts) {
    // Project files share one history per path across the project's tasks.
    const key = `${a.projectId ? `p:${a.projectId}` : `t:${a.taskId}`}\u0000${a.path}`;
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
            nameOf={nameOf}
            taskTitle={showTask ? tasks.find((t) => t.id === latest.taskId)?.title : undefined}
            projectName={showProject ? projects.find((p) => p.id === latest.projectId)?.name : undefined}
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
  nameOf,
  taskTitle,
  projectName,
  onChange,
}: {
  latest: ArtifactInfo;
  older: ArtifactInfo[];
  nameOf: (agentId: string | null) => string;
  taskTitle?: string;
  projectName?: string;
  onChange?: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(latest.status);
  const href = `/api/ui/artifacts/${latest.id}`;
  return (
    <li className="card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-8 w-10 shrink-0 place-items-center rounded bg-canvas font-mono text-[11px] text-ink-soft">{KIND_ICON[latest.kind]}</span>
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-sm font-medium sm:truncate">{latest.path}</p>
          <p className="text-xs text-ink-faint sm:truncate">
            v{latest.version} · {bytes(latest.sizeBytes)} · by {nameOf(latest.agentId)} · {timeAgo(latest.createdAt)}
            {projectName && <> · {projectName}</>}
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
                <span>v{v.version} · {bytes(v.sizeBytes)} · by {nameOf(v.agentId)} · {timeAgo(v.createdAt)}</span>
                <a className="text-brand hover:underline" href={`/api/ui/artifacts/${v.id}`} target="_blank" rel="noreferrer">Open</a>
                <a className="text-brand hover:underline" href={`/api/ui/artifacts/${v.id}?download=1`}>Download</a>
                {isText(v) && isText(latest) && (
                  <button type="button" className="text-brand hover:underline" onClick={() => setCompareWith((c) => (c === v.id ? null : v.id))}>
                    {compareWith === v.id ? "Hide changes" : `Changes since v${v.version}`}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {compareWith && <VersionDiff fromId={compareWith} toId={latest.id} />}
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

type DiffResult = Awaited<ReturnType<typeof diffArtifactsAction>>;

const LINE_STYLE = {
  same: "text-ink-soft",
  add: "bg-[#e6f7ee] text-[#0b6b3a]",
  del: "bg-[#fde8ec] text-[#a1203a]",
} as const;

/** Changed lines between two versions, with a few unchanged lines around each change. */
function VersionDiff({ fromId, toId }: { fromId: string; toId: string }) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  useEffect(() => {
    let live = true;
    setDiff(null);
    diffArtifactsAction(fromId, toId)
      .then((d) => live && setDiff(d))
      .catch(() => live && setDiff({ error: "Could not compare these versions" }));
    return () => {
      live = false;
    };
  }, [fromId, toId]);
  if (!diff) return <p className="mt-3 text-xs text-ink-soft">Comparing…</p>;
  if ("error" in diff) return <p className="mt-3 text-xs text-ink-soft">{diff.error}</p>;
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs text-ink-soft">
        v{diff.from} → v{diff.to}: <span className="text-[#0b6b3a]">+{diff.added}</span> <span className="text-[#a1203a]">−{diff.removed}</span>
      </p>
      <div className="max-h-96 overflow-auto rounded bg-white font-mono text-xs ring-1 ring-line">
        {!diff.hunks.length && <p className="p-3 font-sans text-ink-soft">No changes.</p>}
        {diff.hunks.map((h, hi) => (
          <div key={hi}>
            {h.skippedBefore > 0 && <p className="bg-canvas px-3 py-1 font-sans text-[11px] text-ink-faint">{h.skippedBefore} unchanged lines</p>}
            {h.lines.map((l, li) => (
              <pre key={li} className={`whitespace-pre-wrap px-3 ${LINE_STYLE[l.type]}`}>
                <span className="mr-3 inline-block w-8 select-none text-right text-ink-faint">{l.newNo ?? l.oldNo}</span>
                {l.type === "add" ? "+ " : l.type === "del" ? "− " : "  "}
                {l.text}
              </pre>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
