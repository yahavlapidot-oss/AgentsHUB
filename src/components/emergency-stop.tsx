"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { emergencyStopAction, resumeAllAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";
import { useLive } from "./live";

/** The red button in the sidebar. Takes two clicks, so a stray one doesn't stop everything. */
export function EmergencyStopButton({ compact = false }: { compact?: boolean }) {
  const { emergencyStop, refresh } = useLive();
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5_000);
    return () => clearTimeout(t);
  }, [armed]);
  if (emergencyStop) return null;
  return (
    <button
      type="button"
      disabled={busy}
      className={`flex items-center justify-center gap-2 rounded-md text-sm font-medium text-white transition-colors ${compact ? "min-h-9 px-3 py-1.5" : "mx-2 mb-4 px-2.5 py-2"} ${armed ? "bg-[#e2445c]" : "bg-[#e2445c]/20 hover:bg-[#e2445c]/40"}`}
      title="Stop every agent and close every cloud computer"
      onClick={async () => {
        if (!armed) return setArmed(true);
        setBusy(true);
        await emergencyStopAction();
        setArmed(false);
        setBusy(false);
        await refresh();
        router.refresh();
      }}
    >
      <span aria-hidden>■</span>
      {compact ? (
        <span>{armed ? "Tap again to stop all" : "Stop all"}</span>
      ) : (
        <span className="hidden md:inline">{armed ? "Click again to stop all" : "Stop all agents"}</span>
      )}
    </button>
  );
}

/** Shown on every page while the emergency stop is on. */
export function EmergencyStopBanner() {
  const { emergencyStop, refresh } = useLive();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!emergencyStop) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 bg-[#e2445c] px-4 sm:px-6 py-2.5 text-sm text-white">
      <span className="font-semibold">Emergency stop is on</span>
      <span className="text-white/80">
        Since {timeAgo(emergencyStop.at)}: no agent starts work, every action is refused, and the cloud computers were closed.
      </span>
      <button
        type="button"
        disabled={busy}
        className="ml-auto rounded-md bg-white px-3 py-1 font-medium text-[#e2445c]"
        onClick={async () => {
          setBusy(true);
          await resumeAllAction();
          setBusy(false);
          await refresh();
          router.refresh();
        }}
      >
        {emergencyStop.agentIds.length
          ? `Resume ${emergencyStop.agentIds.length} agent${emergencyStop.agentIds.length === 1 ? "" : "s"}`
          : "Turn off the emergency stop"}
      </button>
    </div>
  );
}
