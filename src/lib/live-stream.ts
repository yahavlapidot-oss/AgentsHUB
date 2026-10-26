/**
 * Live updates for open dashboards over one Server-Sent Events stream each.
 * While anyone is watching, the server builds the snapshot once a second and a
 * half and pushes it only when something changed, so every open tab updates
 * together instead of each polling on its own.
 */
import { getSnapshot } from "./data";
import { contentTag } from "./etag";

export type LiveFrame = { tag: string; json: string };
type Listener = (frame: LiveFrame) => void;

const TICK_MS = Number(process.env.LIVE_TICK_MS ?? 1500);

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;
let last: LiveFrame | null = null;
let busy = false;

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const snap = await getSnapshot();
    const tag = contentTag(snap);
    if (tag === last?.tag) return;
    last = { tag, json: JSON.stringify({ tag, snap }) };
    for (const l of listeners) l(last);
  } catch (e) {
    console.error("[live] snapshot failed", e);
  } finally {
    busy = false;
  }
}

/** Calls the listener with the latest frame now (if any) and on every change. Returns the unsubscribe. */
export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener);
  if (last) listener(last);
  if (!timer) {
    timer = setInterval(() => void tick(), TICK_MS);
    void tick();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
      last = null;
    }
  };
}

export function liveWatchers(): number {
  return listeners.size;
}
