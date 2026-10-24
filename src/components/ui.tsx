"use client";

import { useEffect, useRef, useState } from "react";
import { AGENT_STATUS_META, PROVIDER_META, initials } from "@/lib/format";
import type { PublicAgent } from "@/lib/schema";

export function AgentAvatar({ agent, size = 28 }: { agent: PublicAgent | null | undefined; size?: number }) {
  if (!agent) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-full border border-dashed border-ink-faint text-[10px] text-ink-faint"
        style={{ width: size, height: size }}
        title="Unassigned"
      >
        ?
      </span>
    );
  }
  const color = PROVIDER_META[agent.provider].color;
  const status = AGENT_STATUS_META[agent.status];
  return (
    <span className="relative inline-block h-fit shrink-0 self-start" title={`${agent.name} · ${agent.model} · ${status.label}`}>
      <span
        className="grid place-items-center rounded-full font-semibold text-white"
        style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      >
        {initials(agent.name)}
      </span>
      <span
        className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white"
        style={{ width: size * 0.34, height: size * 0.34, background: status.color }}
      />
    </span>
  );
}

export function UserAvatar({ size = 28 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-ink font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      title="You"
    >
      You
    </span>
  );
}

export function ProviderTag({ provider }: { provider: PublicAgent["provider"] }) {
  const meta = PROVIDER_META[provider];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: `${meta.color}1a`, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

export function ProgressBar({ pct, color = "#00c875" }: { pct: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#e6e9ef]">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-9 text-right font-mono text-xs tabular-nums text-ink-soft">{pct}%</span>
    </div>
  );
}

/** A Monday-style colored cell that opens a list of colored options. */
export function ColorPicker<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: Record<T, { label: string; color: string; text: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const meta = options[value];
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="h-full w-full truncate px-2 py-2 text-center text-[13px] font-medium transition-opacity hover:opacity-90"
        style={{ background: meta.color, color: meta.text }}
      >
        {meta.label}
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-30 mt-1 w-44 -translate-x-1/2 rounded-lg border border-line bg-white p-2 shadow-xl">
          {(Object.keys(options) as T[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                if (k !== value) onChange(k);
              }}
              className="mb-1 block w-full rounded px-2 py-1.5 text-center text-[13px] font-medium last:mb-0 hover:opacity-90"
              style={{ background: options[k].color, color: options[k].text }}
            >
              {options[k].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onOutside]);
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white p-6 shadow-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost -mr-2 -mt-1 px-2" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-ink-soft">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function CopyBox({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      {label && <span className="label">{label}</span>}
      <pre className="overflow-x-auto rounded-md bg-nav p-3 pr-16 font-mono text-xs leading-relaxed text-white/90">
        {text}
      </pre>
      <button
        type="button"
        className="absolute bottom-2 right-2 rounded bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line bg-white px-6 py-5">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
