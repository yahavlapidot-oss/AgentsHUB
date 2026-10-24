"use client";

import { Activity } from "../board/task-drawer";
import type { AgentEvent } from "@/lib/schema";

export function AgentTimeline({ events }: { events: AgentEvent[] }) {
  return <Activity events={events} />;
}
