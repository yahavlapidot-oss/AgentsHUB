"use server";

import { createSchedule, deleteSchedule, fireSchedule, getSchedule, setScheduleEnabled, updateSchedule, type ScheduleInput } from "@/lib/schedules";
import { z } from "zod";

// Server actions for the Schedules page. The user is the author.

function message(e: unknown): string {
  return e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : (e as Error).message;
}

export async function saveScheduleAction(id: string | null, input: z.input<typeof ScheduleInput>): Promise<{ error?: string }> {
  try {
    if (id) await updateSchedule(id, input);
    else await createSchedule(input);
    return {};
  } catch (e) {
    return { error: message(e) };
  }
}

export async function setScheduleEnabledAction(id: string, enabled: boolean) {
  await setScheduleEnabled(id, enabled);
}

export async function deleteScheduleAction(id: string) {
  await deleteSchedule(id);
}

export async function runScheduleNowAction(id: string): Promise<{ taskId: string | null }> {
  const s = await getSchedule(id);
  if (!s) throw new Error("This schedule no longer exists");
  return fireSchedule(s, Date.now(), { manual: true });
}
