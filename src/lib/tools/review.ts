/** The reviewer's tool in the quality loop (see quality.ts). */
import { z } from "zod";
import { str, tool, type AgentTool } from "../agent-tools";
import { recordVerdict } from "../quality";

export const REVIEW_TOOLS: AgentTool[] = [
  tool({
    name: "review_verdict",
    description:
      "Give your verdict on a task you were asked to review: approve it (it goes to the user), or request changes (it goes back to its owner with your feedback). Be specific: what's wrong, where, and what done looks like. This also closes your review task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: str("The reviewed task's id (not your review task)"),
        verdict: { type: "string", enum: ["approve", "changes"] },
        feedback: str("What you checked and what you found; for changes, exactly what to fix"),
      },
      required: ["taskId", "verdict", "feedback"],
    },
    args: z.object({ taskId: z.string(), verdict: z.enum(["approve", "changes"]), feedback: z.string().trim().min(10, "Say what you checked").max(10_000) }),
    run: async (input, { agent }) => {
      const { task, sentBack } = await recordVerdict({ reviewerId: agent.id, ...input });
      return { task: { id: task.id, title: task.title, column: task.column }, sentBack };
    },
  }),
];
