/**
 * The quality loop. When an agent finishes a task, a reviewer agent (if you
 * picked one in Settings) checks it against the acceptance criteria before it
 * reaches you: it approves, or sends it back with what to fix (at most a few
 * rounds). Your own 👍/👎 on a finished task goes into the owner's memory, so
 * the next run starts from what you liked and didn't.
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "./db";
import { addEvent, ConflictError, createTask, getAgent, getSetting, getTask, postMessage, rememberForAgent, setSetting, updateTask } from "./data";
import { boardLink, notify } from "./notify";
import { tasks, type Task } from "./schema";

export const REVIEW_MODES = ["off", "important", "all"] as const;
export type QualitySettings = { reviewerAgentId: string | null; mode: (typeof REVIEW_MODES)[number]; maxRounds: number };

const KEY = "quality";
const DEFAULTS: QualitySettings = { reviewerAgentId: null, mode: "off", maxRounds: 2 };

export async function getQualitySettings(): Promise<QualitySettings> {
  return { ...DEFAULTS, ...((await getSetting<Partial<QualitySettings>>(KEY)) ?? {}) };
}

export async function setQualitySettings(s: QualitySettings): Promise<void> {
  if (s.reviewerAgentId && !(await getAgent(s.reviewerAgentId))) throw new ConflictError("Pick an existing agent");
  await setSetting(KEY, { reviewerAgentId: s.reviewerAgentId, mode: REVIEW_MODES.includes(s.mode) ? s.mode : "off", maxRounds: Math.max(1, Math.min(5, Math.round(s.maxRounds))) });
}

export const reviewMarker = (taskId: string) => `review:${taskId}`;
export const isReviewTask = (t: Pick<Task, "createdBy">) => t.createdBy.startsWith("review:");

async function reviewTasksOf(taskId: string): Promise<Task[]> {
  return db.select().from(tasks).where(eq(tasks.createdBy, reviewMarker(taskId)));
}

/**
 * After an agent finishes a task: if a review is due, adds a Ready task for the
 * reviewer. Returns that task, or null when no review is due.
 */
export async function maybeRequestReview(task: Task, finishedBy: string, summary: string): Promise<Task | null> {
  const s = await getQualitySettings();
  if (s.mode === "off" || !s.reviewerAgentId || s.reviewerAgentId === finishedBy || isReviewTask(task)) return null;
  if (s.mode === "important" && task.priority !== "high" && task.priority !== "critical") return null;
  const reviewer = await getAgent(s.reviewerAgentId);
  if (!reviewer || reviewer.kind !== "hosted") return null;
  const earlier = await reviewTasksOf(task.id);
  if (earlier.length >= s.maxRounds) return null;
  if (earlier.some((t) => t.column !== "done")) return null;
  const review = await createTask({
    title: `Review: ${task.title}`.slice(0, 200),
    description: [
      `Check the work on task ${task.id} before it goes to the user.`,
      task.description && `What was asked:\n${task.description}`,
      `What the agent says it did:\n${summary.slice(0, 6_000)}`,
      `Read the task and its files with get_task and read_saved_file. Then call review_verdict with taskId ${task.id}: approve if it meets the acceptance criteria, or ask for changes with specific, actionable feedback. Don't redo the work yourself.`,
      earlier.length ? `This is review round ${earlier.length + 1} of at most ${s.maxRounds}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    acceptanceCriteria: task.acceptanceCriteria,
    priority: task.priority,
    projectId: task.projectId,
    ownerAgentId: reviewer.id,
    column: "ready",
    createdBy: reviewMarker(task.id),
  });
  await addEvent({ agentId: null, taskId: task.id, type: "note", payload: { text: `Sent to ${reviewer.name} for review` } });
  return review;
}

/** The reviewer's answer: approve (the task waits for you in review) or send it back to its owner. */
export async function recordVerdict(input: { reviewerId: string; taskId: string; verdict: "approve" | "changes"; feedback: string }): Promise<{ task: Task; sentBack: boolean }> {
  const task = await getTask(input.taskId);
  if (!task) throw new ConflictError(`No task ${input.taskId}`);
  const [review] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.createdBy, reviewMarker(task.id)), eq(tasks.ownerAgentId, input.reviewerId), ne(tasks.column, "done")));
  if (!review) throw new ConflictError("You have no open review of that task");
  const reviewer = await getAgent(input.reviewerId);
  const sentBack = input.verdict === "changes" && Boolean(task.ownerAgentId) && task.column === "review";
  await addEvent({
    agentId: input.reviewerId,
    taskId: task.id,
    type: "note",
    payload: { text: `${input.verdict === "approve" ? "✅ Review passed" : "↩ Changes requested"} (${reviewer?.name ?? "reviewer"}): ${input.feedback}`.slice(0, 8_000) },
  });
  if (sentBack) {
    await updateTask(task.id, { column: "ready", progressPct: 50 }, { agentId: input.reviewerId });
    await postMessage({
      fromAgentId: input.reviewerId,
      toAgentId: task.ownerAgentId,
      taskId: task.id,
      text: `I reviewed "${task.title}" and it needs changes before it goes to the user:\n${input.feedback}`.slice(0, 8_000),
    });
  }
  await updateTask(review.id, { column: "done" }, { agentId: input.reviewerId });
  if (!sentBack) {
    await notify(
      `[AgentsHUB] "${task.title}" is ready for you`,
      `${reviewer?.name ?? "The reviewer"} checked it: ${input.verdict === "approve" ? "approved" : "has notes"}.\n${input.feedback.slice(0, 3_000)}\n\n${boardLink(`/?task=${task.id}`)}`,
      { kind: "finished" },
    );
  }
  return { task: (await getTask(task.id))!, sentBack };
}

/** Your 👍 or 👎 on a task. The owner agent keeps it as a memory titled after the task. */
export async function rateTask(taskId: string, rating: 1 | -1 | null, note = ""): Promise<Task> {
  const task = await getTask(taskId);
  if (!task) throw new ConflictError(`No task ${taskId}`);
  await db.update(tasks).set({ rating, ratingNote: note.trim().slice(0, 2_000) || null, updatedAt: Date.now() }).where(eq(tasks.id, taskId));
  if (rating && task.ownerAgentId) {
    const text =
      rating > 0
        ? `The user liked your result on "${task.title}".${note.trim() ? ` They said: ${note.trim()}` : ""} Keep doing it this way.`
        : `The user was not happy with your result on "${task.title}".${note.trim() ? ` They said: ${note.trim()}` : ""} Avoid repeating this.`;
    try {
      await rememberForAgent({ agentId: task.ownerAgentId, title: `Feedback: ${task.title}`.slice(0, 120), text, taskId });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      // Memory is full; the rating is still saved on the task.
    }
  }
  return (await getTask(taskId))!;
}
