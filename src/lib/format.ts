import type { Column, Priority, Provider } from "./schema";

export const COLUMN_META: Record<Column, { label: string; color: string; text: string }> = {
  backlog: { label: "Backlog", color: "#c4c4c4", text: "#323338" },
  ready: { label: "Ready", color: "#579bfc", text: "#ffffff" },
  in_progress: { label: "Working on it", color: "#fdab3d", text: "#ffffff" },
  waiting_on_you: { label: "Waiting on you", color: "#e2445c", text: "#ffffff" },
  review: { label: "In review", color: "#a25ddc", text: "#ffffff" },
  done: { label: "Done", color: "#00c875", text: "#ffffff" },
};

export const PRIORITY_META: Record<Priority, { label: string; color: string; text: string }> = {
  low: { label: "Low", color: "#79affd", text: "#ffffff" },
  medium: { label: "Medium", color: "#5559df", text: "#ffffff" },
  high: { label: "High", color: "#401694", text: "#ffffff" },
  critical: { label: "Critical ⚠", color: "#333333", text: "#ffffff" },
};

/** Model lists are suggestions for the connect form; any model name is accepted. */
export const PROVIDER_META: Record<Provider, { label: string; color: string; models: string[] }> = {
  anthropic: { label: "Claude", color: "#d97757", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  openai: { label: "GPT / Codex", color: "#10a37f", models: ["gpt-5", "gpt-5-codex", "gpt-5-mini"] },
  google: { label: "Gemini", color: "#4285f4", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  custom: { label: "Custom", color: "#676879", models: [] },
};

export const AGENT_STATUS_META = {
  active: { label: "Working", color: "#00c875" },
  waiting: { label: "Waiting on you", color: "#e2445c" },
  paused: { label: "Paused", color: "#fdab3d" },
  offline: { label: "Offline", color: "#c4c4c4" },
} as const;

export function timeAgo(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export function usd(n: number): string {
  return n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`;
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
