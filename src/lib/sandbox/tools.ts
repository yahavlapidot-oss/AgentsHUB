/**
 * Tools for hosted agents that have a cloud computer. The runner adds these to
 * the board tools when the agent has "cloud computer" on and the server has a
 * sandbox provider key. Commands pass the same approval gate as every other
 * agent action, except the "irreversible" rules: deleting files inside a
 * throwaway sandbox is fine, pushing or deploying from it is not.
 */
import { z } from "zod";
import { str, tool, ToolInputError, type AgentTool, type ToolContext } from "../agent-tools";
import { gateAction } from "../control";
import { addEvent } from "../data";
import { WORKDIR } from "./session";

function session(ctx: ToolContext) {
  if (!ctx.sandbox) throw new ToolInputError("You have no cloud computer");
  return ctx.sandbox;
}

/** Provider and limit errors go back to the model as tool errors it can act on. */
async function asToolError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolInputError) throw e;
    throw new ToolInputError((e as Error).message ?? String(e));
  }
}

export const SANDBOX_TOOLS: AgentTool[] = [
  tool({
    name: "run_command",
    description: `Run a shell command in your cloud computer (Linux with Node.js, npm, Python and pip; internet access). It starts in ${WORKDIR}. Use it to install packages, run code and run tests. Set background=true for servers that keep running, then get their address with preview_url. Pushing, deploying, publishing or anything that sends or pays outside needs the user's approval first.`,
    inputSchema: {
      type: "object",
      properties: {
        command: str("The shell command, e.g. 'npm test'"),
        cwd: str(`Folder to run in, relative to ${WORKDIR} (optional)`),
        timeoutSeconds: { type: "number", description: "Stop the command after this many seconds (max 300)" },
        background: { type: "boolean", description: "Start it and return right away (for dev servers)" },
      },
      required: ["command"],
    },
    args: z.object({
      command: z.string().min(1).max(10_000),
      cwd: z.string().max(500).optional(),
      timeoutSeconds: z.number().min(1).max(300).optional(),
      background: z.boolean().optional(),
    }),
    run: async ({ command, cwd, timeoutSeconds, background }, ctx) => {
      const sandbox = session(ctx);
      const gate = await gateAction(ctx.agent.id, {
        action: `Sandbox: ${command}`,
        taskId: ctx.taskId,
        ignore: ["irreversible"],
        askIfCautious: true,
      });
      const result = gate.decision === "ask" && ctx.waitForApproval ? await ctx.waitForApproval(gate) : gate;
      if (result.decision !== "allow") {
        return { ran: false, decision: result.decision, reason: result.reasons.join(", ") || "The user didn't approve this command" };
      }
      return asToolError(async () => {
        if (background) {
          const { pid } = await sandbox.start(command, { cwd });
          await log(ctx, { tool: "run_command", input: { command, background: true }, text: `Started in the background: ${command}` });
          return { started: true, pid, hint: "Give it a few seconds, then check it with run_command (e.g. curl localhost:PORT) and share it with preview_url." };
        }
        const r = await sandbox.run(command, { cwd, timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined });
        await log(ctx, {
          tool: "run_command",
          input: { command },
          text: `$ ${command} → exit ${r.exitCode}`,
          output: [r.stdout, r.stderr].filter(Boolean).join("\n").slice(-OUTPUT_KEPT),
        });
        return r;
      });
    },
  }),

  tool({
    name: "write_file",
    description: `Create or overwrite a text file in your cloud computer. Paths are relative to ${WORKDIR}; folders are created as needed.`,
    inputSchema: {
      type: "object",
      properties: { path: str("File path, e.g. 'src/index.ts'"), content: str("The whole file") },
      required: ["path", "content"],
    },
    args: z.object({ path: z.string().min(1).max(500), content: z.string().max(2_000_000) }),
    run: async ({ path, content }, ctx) =>
      asToolError(async () => {
        const full = await session(ctx).writeFile(path, content);
        await log(ctx, { tool: "write_file", input: { path }, text: `Wrote ${full} (${content.length} characters)`, type: "file_edit" });
        return { path: full, characters: content.length };
      }),
  }),

  tool({
    name: "read_file",
    description: `Read a text file from your cloud computer. Paths are relative to ${WORKDIR}.`,
    inputSchema: { type: "object", properties: { path: str("File path") }, required: ["path"] },
    args: z.object({ path: z.string().min(1).max(500) }),
    run: async ({ path }, ctx) =>
      asToolError(async () => {
        const bytes = await session(ctx).readFile(path);
        if (bytes.subarray(0, 8192).includes(0)) return { path, binary: true, sizeBytes: bytes.length };
        const text = Buffer.from(bytes).toString("utf8");
        return text.length > 60_000 ? { path, content: text.slice(0, 60_000), truncated: true, characters: text.length } : { path, content: text };
      }),
  }),

  tool({
    name: "list_files",
    description: `List files and folders in your cloud computer. Paths are relative to ${WORKDIR}.`,
    inputSchema: {
      type: "object",
      properties: { path: str("Folder (default: the work folder)"), depth: { type: "number", description: "How many levels down (1 to 5, default 2)" } },
    },
    args: z.object({ path: z.string().max(500).optional(), depth: z.number().min(1).max(5).optional() }),
    run: async ({ path, depth }, ctx) =>
      asToolError(async () => {
        const entries = await session(ctx).list(path ?? ".", depth ?? 2);
        const visible = entries.filter((e) => !e.path.includes("/node_modules/") && !e.path.includes("/.git/"));
        return { entries: visible.slice(0, 500).map((e) => ({ path: e.path, type: e.type, size: e.size })), more: visible.length > 500 || undefined };
      }),
  }),

  tool({
    name: "preview_url",
    description: "Public https address of a port in your cloud computer, so the user can open a dev server you started. It stops working when the task ends; save the files with save_artifact too.",
    inputSchema: { type: "object", properties: { port: { type: "number", description: "Port the server listens on" } }, required: ["port"] },
    args: z.object({ port: z.number().int().min(1).max(65_535) }),
    run: async ({ port }, ctx) => {
      const gate = await gateAction(ctx.agent.id, { action: `Share a public preview link to port ${port}`, taskId: ctx.taskId, askIfCautious: true });
      const result = gate.decision === "ask" && ctx.waitForApproval ? await ctx.waitForApproval(gate) : gate;
      if (result.decision !== "allow") return { shared: false, decision: result.decision, reason: result.reasons.join(", ") || "The user didn't approve sharing a link" };
      return asToolError(async () => {
        const url = await session(ctx).previewUrl(port);
        await log(ctx, { tool: "preview_url", input: { port }, text: `Preview: ${url}` });
        return { url };
      });
    },
  }),
];

/** How much of a command's output the activity log keeps, for the Live workspace. */
const OUTPUT_KEPT = 4_000;

/** Names of sandbox tools that write their own activity line. */
export const SANDBOX_LOGGED_TOOLS = new Set(["run_command", "write_file", "preview_url"]);

async function log(
  ctx: ToolContext,
  e: { tool: string; input: unknown; text: string; output?: string; type?: "tool_call" | "file_edit" },
): Promise<void> {
  await addEvent({
    agentId: ctx.agent.id,
    taskId: ctx.taskId ?? null,
    runId: ctx.runId ?? null,
    type: e.type ?? "tool_call",
    payload: { tool: e.tool, input: e.input, text: e.text, ...(e.output ? { output: e.output } : {}), sandboxId: ctx.sandbox?.id },
  });
}
