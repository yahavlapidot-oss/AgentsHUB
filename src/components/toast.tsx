"use client";

import { useSyncExternalStore } from "react";

type Toast = { id: number; text: string; tone: "ok" | "error" };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** A short message at the bottom of the screen that goes away on its own. Callable from anywhere on the client. */
export function toast(text: string, tone: Toast["tone"] = "ok") {
  const id = nextId++;
  toasts = [...toasts.slice(-2), { id, text, tone }];
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 6000 : 2500);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
    >
      {list.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          role={t.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex max-w-sm animate-toast-in items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${t.tone === "error" ? "bg-[#d83a52]" : "bg-nav"}`}
        >
          <span aria-hidden>{t.tone === "error" ? "!" : "✓"}</span>
          {t.text}
        </button>
      ))}
    </div>
  );
}
