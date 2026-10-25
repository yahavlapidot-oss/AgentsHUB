"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setAgentToolAction } from "@/app/actions";

export type AgentToolRow = {
  name: string;
  summary: string;
  category: string;
  risk: "read" | "write" | "external";
  core: boolean;
  needsSandbox: boolean;
  enabled: boolean;
};

const RISK_META = {
  read: { label: "Reads", className: "bg-canvas text-ink-soft" },
  write: { label: "Changes", className: "bg-[#fff6e5] text-[#7a4a00]" },
  external: { label: "Reaches outside", className: "bg-[#fde8ec] text-[#a1203a]" },
} as const;

/** The agent's tools, grouped by category, with a switch for each one that isn't core. */
export function AgentTools({ agentId, groups, sandboxOn }: { agentId: string; groups: { label: string; tools: AgentToolRow[] }[]; sandboxOn: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  // On a phone the long list starts folded.
  const [open, setOpen] = useState(false);
  const all = groups.flatMap((g) => g.tools);
  const on = all.filter((t) => t.enabled).length;
  return (
    <section className="card">
      <h2 className="flex items-center justify-between border-b border-line px-4 py-3 font-semibold">
        Tools
        <button type="button" className="btn-ghost text-xs sm:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : `Show all (${on} of ${all.length} on)`}
        </button>
      </h2>
      <div className={open ? "" : "hidden sm:block"}>
        <p className="px-4 pt-3 text-sm text-ink-soft">
          What this agent can do. Turned-off tools are hidden from it. Core tools keep the board working and always stay on. Risky
          actions still need your approval on top.
        </p>
        <div className="flex flex-col gap-4 p-4">
          {groups.map((g) => (
            <div key={g.label}>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-faint">{g.label}</h3>
              <ul className="divide-y divide-line rounded-md ring-1 ring-line">
                {g.tools.map((t) => {
                  const inactive = t.needsSandbox && !sandboxOn;
                  return (
                    <li key={t.name} className="flex items-start gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        aria-label={`${t.name} on`}
                        checked={t.enabled}
                        disabled={t.core || pending === t.name}
                        onChange={async (e) => {
                          setPending(t.name);
                          await setAgentToolAction(agentId, t.name, e.target.checked);
                          setPending(null);
                          router.refresh();
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px]">{t.name}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[11px] ${RISK_META[t.risk].className}`}>{RISK_META[t.risk].label}</span>
                          {t.core && <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] text-brand">Core</span>}
                          {inactive && <span className="text-[11px] text-ink-faint">needs Cloud computer</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-soft">{t.summary}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
