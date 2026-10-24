"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/data";

const POLL_MS = 3000;

type Live = Snapshot & { refresh: () => Promise<void> };

const LiveContext = createContext<Live | null>(null);

/**
 * Holds the live board data. Today it polls /api/ui/snapshot; swapping this for
 * a WebSocket or SSE stream only touches this file.
 */
export function LiveProvider({ initial, children }: { initial: Snapshot; children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/ui/snapshot", { cache: "no-store" });
      if (res.ok) setSnap(await res.json());
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return <LiveContext.Provider value={{ ...snap, refresh }}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used inside <LiveProvider>");
  return ctx;
}
