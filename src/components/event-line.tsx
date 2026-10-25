import { COLUMN_META } from "@/lib/format";
import type { AgentEvent, Column } from "@/lib/schema";

const ICON: Record<AgentEvent["type"], string> = {
  tool_call: "⚙",
  file_edit: "✎",
  note: "•",
  error: "⚠",
  status_change: "⇄",
};

/** One readable line for an activity event. */
export function describeEvent(e: AgentEvent): { icon: string; text: string; tone: "default" | "error"; detail?: string } {
  const p = e.payload as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  // Lines written by the runner and the sandbox tools carry their own text.
  if (e.type !== "error" && e.type !== "note" && str("text")) {
    return { icon: ICON[e.type], text: str("text")!, tone: "default", detail: str("output") };
  }
  switch (e.type) {
    case "status_change": {
      const from = COLUMN_META[p.from as Column]?.label ?? String(p.from);
      const to = COLUMN_META[p.to as Column]?.label ?? String(p.to);
      return { icon: ICON.status_change, text: `Moved from ${from} to ${to}`, tone: "default" };
    }
    case "tool_call":
      return { icon: ICON.tool_call, text: `Ran ${str("tool") ?? "a tool"}${str("summary") ? `: ${str("summary")}` : ""}`, tone: "default" };
    case "file_edit":
      return { icon: ICON.file_edit, text: `Edited ${str("path") ?? "a file"}${str("summary") ? `: ${str("summary")}` : ""}`, tone: "default" };
    case "error":
      return { icon: ICON.error, text: str("message") ?? str("text") ?? "Error", tone: "error" };
    default:
      return { icon: ICON.note, text: str("text") ?? JSON.stringify(p), tone: "default" };
  }
}
