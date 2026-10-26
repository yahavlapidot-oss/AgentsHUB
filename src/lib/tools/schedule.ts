/**
 * Tools for recurring work: an agent (usually the chief of staff) can set up
 * "every morning at 8, …" when the user asks for it. Agents can't schedule
 * anything more often than hourly; the user can, on the Schedules page.
 */
import { z } from "zod";
import { str, tool, ToolInputError, type AgentTool } from "../agent-tools";
import { postMessage } from "../data";
import { createSchedule, describeTiming, getSchedules, setScheduleEnabled, DEFAULT_TIMEZONE } from "../schedules";
import { PRIORITIES, SCHEDULE_FREQUENCIES } from "../schema";

export const SCHEDULE_TOOLS: AgentTool[] = [
  tool({
    name: "schedule_task",
    description:
      "Set up recurring work: at each time, a task with this title and description is added to Ready for ownerAgentId (or whoever fits). Only when the user asked for something recurring. Times are in the user's time zone unless you pass one.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Task title, e.g. 'Morning news summary'"),
        description: str("What to do each time, and what to deliver"),
        frequency: { type: "string", enum: SCHEDULE_FREQUENCIES.filter((f) => f !== "minutes"), description: "How often" },
        timeOfDay: str("HH:MM, 24-hour (for hourly only the minutes count)"),
        weekdays: { type: "array", items: { type: "number" }, description: "Weekly: days, 0 = Sunday … 6 = Saturday" },
        dayOfMonth: { type: "number", description: "Monthly: day 1-28" },
        ownerAgentId: str("Agent who does it each time, from list_agents"),
        projectId: str("Project to put the tasks in (optional)"),
        priority: { type: "string", enum: [...PRIORITIES] },
        timezone: str(`IANA time zone (default ${DEFAULT_TIMEZONE})`),
      },
      required: ["title", "frequency"],
    },
    args: z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(10_000).optional(),
      frequency: z.enum(["hourly", "daily", "weekly", "monthly"]),
      timeOfDay: z.string().optional(),
      weekdays: z.array(z.number().int().min(0).max(6)).optional(),
      dayOfMonth: z.number().int().min(1).max(28).optional(),
      ownerAgentId: z.string().optional(),
      projectId: z.string().optional(),
      priority: z.enum(PRIORITIES).optional(),
      timezone: z.string().optional(),
    }),
    run: async (input, ctx) => {
      let s;
      try {
        s = await createSchedule(
          {
            title: input.title,
            description: input.description ?? "",
            frequency: input.frequency,
            timeOfDay: input.timeOfDay ?? "08:00",
            weekdays: input.weekdays ?? [],
            dayOfMonth: input.dayOfMonth ?? null,
            ownerAgentId: input.ownerAgentId || null,
            projectId: input.projectId || ctx.projectId || null,
            priority: input.priority ?? "medium",
            timezone: input.timezone ?? DEFAULT_TIMEZONE,
          },
          ctx.agent.id,
        );
      } catch (e) {
        throw new ToolInputError(e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : (e as Error).message);
      }
      const where = ctx.chatChannel ?? ctx.projectId;
      if (where && !ctx.taskId) {
        await postMessage({ fromAgentId: ctx.agent.id, projectId: where, text: `New schedule: ${s.title} (${describeTiming(s).toLowerCase()})` });
      }
      return { schedule: { id: s.id, title: s.title, when: describeTiming(s), timezone: s.timezone, nextRunAt: s.nextRunAt && new Date(s.nextRunAt).toISOString() } };
    },
  }),

  tool({
    name: "list_schedules",
    description: "List the recurring tasks that are set up, with when each runs next.",
    inputSchema: { type: "object", properties: {} },
    args: z.object({}),
    run: async () => ({
      schedules: (await getSchedules()).map((s) => ({
        id: s.id,
        title: s.title,
        when: describeTiming(s),
        enabled: s.enabled,
        ownerAgentId: s.ownerAgentId,
        projectId: s.projectId,
        nextRunAt: s.nextRunAt && new Date(s.nextRunAt).toISOString(),
      })),
    }),
  }),

  tool({
    name: "pause_schedule",
    description: "Pause (or resume) a recurring task, when the user asks to stop or restart it.",
    inputSchema: { type: "object", properties: { scheduleId: str("Schedule id from list_schedules"), paused: { type: "boolean", description: "true to pause, false to resume" } }, required: ["scheduleId", "paused"] },
    args: z.object({ scheduleId: z.string(), paused: z.boolean() }),
    run: async ({ scheduleId, paused }) => {
      await setScheduleEnabled(scheduleId, !paused);
      return { ok: true };
    },
  }),
];
