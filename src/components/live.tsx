"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { decideApprovalAction, updateTaskAction } from "@/app/actions";
import type { Snapshot } from "@/lib/data";
import { toast } from "./toast";

const POLL_MS = 3000;
/** How often to poll anyway while the push stream is up. */
const STREAM_POLL_MS = 30_000;
/** How often "5 min ago" style times move on while nothing else changes. */
const CLOCK_MS = 30_000;

type Live = Snapshot & {
  /** Changes only when the data does, unlike generatedAt. */
  version: string;
  refresh: () => Promise<void>;
  /** Changes a task on screen at once and saves it; undone with a message if saving fails. */
  updateTask: (id: string, patch: TaskPatch, done?: string) => Promise<boolean>;
  /** Takes the approval off the list at once and records the decision. */
  decideApproval: (id: string, decision: "approved" | "denied") => Promise<boolean>;
};

type TaskPatch = Parameters<typeof updateTaskAction>[1];

const LiveContext = createContext<Live | null>(null);

/**
 * Holds the live board data. Today it polls /api/ui/snapshot; swapping this for
 * a WebSocket or SSE stream only touches this file.
 *
 * The server answers 304 when nothing changed since the last poll, so an idle
 * board costs a few bytes and no re-render. Changes you make show at once; polls
 * that answer while a change is being saved are dropped, so a stale answer
 * can't undo it on screen.
 */
export function LiveProvider({ initial, initialTag, children }: { initial: Snapshot; initialTag: string; children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [version, setVersion] = useState(initialTag);
  const etag = useRef<string | null>(initialTag);
  const edits = useRef(0);
  const saving = useRef(0);
  const inFlight = useRef(false);
  const again = useRef(false);
  /** When the push stream is up, polling slows to a safety net. */
  const streaming = useRef(false);
  const lastPoll = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    lastPoll.current = Date.now();
    const startedAt = edits.current;
    try {
      const res = await fetch("/api/ui/snapshot", { cache: "no-store", headers: etag.current ? { "if-none-match": etag.current } : {} });
      if (res.status === 304) {
        setSnap((s) => (Date.now() - s.generatedAt >= CLOCK_MS ? { ...s, generatedAt: Date.now() } : s));
        return;
      }
      if (!res.ok) return;
      const next: Snapshot = await res.json();
      if (edits.current !== startedAt || saving.current) return;
      etag.current = res.headers.get("etag");
      setSnap(next);
      setVersion(etag.current ?? String(next.generatedAt));
    } catch {
      // Offline for a moment: the next poll tries again.
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        void refresh();
      }
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (streaming.current && Date.now() - lastPoll.current < STREAM_POLL_MS) return;
      void refresh();
    }, POLL_MS);
    // Coming back to the tab shows fresh data at once instead of after the next tick.
    const onShow = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    window.addEventListener("online", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("online", onShow);
    };
  }, [refresh]);

  // Pushed updates (Server-Sent Events). If the stream drops, the browser reconnects and polling covers the gap.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/ui/stream");
    es.addEventListener("snapshot", (e) => {
      streaming.current = true;
      if (saving.current || inFlight.current) return;
      try {
        const { tag, snap: next } = JSON.parse((e as MessageEvent<string>).data) as { tag: string; snap: Snapshot };
        if (tag === etag.current) return;
        etag.current = tag;
        setSnap(next);
        setVersion(tag);
      } catch {
        // A bad frame: the next one or the next poll fixes it.
      }
    });
    es.onerror = () => {
      streaming.current = false;
    };
    return () => es.close();
  }, []);

  const save = useCallback(
    async (show: (s: Snapshot) => Snapshot, action: () => Promise<unknown>, done?: string) => {
      edits.current++;
      saving.current++;
      setSnap(show);
      let ok = true;
      try {
        await action();
        if (done) toast(done);
      } catch (e) {
        ok = false;
        toast(e instanceof Error && e.message ? `Couldn't save: ${e.message}` : "Couldn't save. Try again.", "error");
      } finally {
        saving.current--;
        edits.current++;
      }
      await refresh();
      return ok;
    },
    [refresh],
  );

  const updateTask = useCallback(
    (id: string, patch: TaskPatch, done?: string) =>
      save((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)) }), () => updateTaskAction(id, patch), done),
    [save],
  );

  const decideApproval = useCallback(
    (id: string, decision: "approved" | "denied") =>
      save((s) => ({ ...s, approvals: s.approvals.filter((a) => a.id !== id) }), () => decideApprovalAction(id, decision), decision === "approved" ? "Approved" : "Denied"),
    [save],
  );

  return <LiveContext.Provider value={{ ...snap, version, refresh, updateTask, decideApproval }}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used inside <LiveProvider>");
  return ctx;
}
