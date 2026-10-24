import { randomBytes } from "node:crypto";

/** Short, sortable-enough ids with a readable prefix, e.g. "task_k3j9x2a1b4". */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}
