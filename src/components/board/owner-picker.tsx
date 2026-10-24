"use client";

import { useRef, useState } from "react";
import { useLive } from "../live";
import { AgentAvatar, ProviderTag, useClickOutside } from "../ui";

/** Click an avatar to hand the task to another agent. */
export function OwnerPicker({
  value,
  onChange,
  children,
}: {
  value: string | null;
  onChange: (agentId: string | null) => void;
  children: React.ReactNode;
}) {
  const { agents } = useLive();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="rounded-full p-0.5 hover:ring-2 hover:ring-brand/30"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Change owner"
      >
        {children}
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-30 mt-1 w-64 -translate-x-1/2 rounded-lg border border-line bg-white p-1 shadow-xl">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-canvas ${
                a.id === value ? "bg-brand-soft" : ""
              }`}
              onClick={() => {
                setOpen(false);
                if (a.id !== value) onChange(a.id);
              }}
            >
              <AgentAvatar agent={a} size={24} />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <ProviderTag provider={a.provider} />
            </button>
          ))}
          {value && (
            <button
              type="button"
              className="mt-1 w-full rounded border-t border-line px-2 py-1.5 text-left text-sm text-ink-soft hover:bg-canvas"
              onClick={() => {
                setOpen(false);
                onChange(null);
              }}
            >
              Unassign
            </button>
          )}
          {!agents.length && <p className="px-2 py-2 text-sm text-ink-soft">No agents connected yet.</p>}
        </div>
      )}
    </div>
  );
}
