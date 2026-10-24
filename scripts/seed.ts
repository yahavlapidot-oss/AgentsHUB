/**
 * Fills the database with example agents and work so the board has something to show.
 * Usage: npm run db:seed            (refuses if there is already data)
 *        npm run db:seed -- --reset (wipes everything first)
 */
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import * as data from "../src/lib/data";
import { agents, approvals, commands, events, messages, runs, tasks } from "../src/lib/schema";

const MIN = 60_000;

async function main() {
  const reset = process.argv.includes("--reset");
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(agents);
  if (n > 0 && !reset) {
    console.log("Database already has agents. Run with --reset to replace them with example data.");
    return;
  }
  for (const t of [events, messages, runs, commands, approvals, tasks, agents]) await db.delete(t);

  const make = (name: string, provider: "anthropic" | "openai" | "google", model: string, skills: string[], machine: string) =>
    data.createAgent({ name, provider, model, skills, machine, kind: provider === "anthropic" ? "claude_code" : "sdk" });

  const backend = await make("Backend Builder", "anthropic", "claude-opus-5-5", ["api", "database"], "MacBook Pro");
  const frontend = await make("UI Crafter", "openai", "gpt-5", ["react", "css"], "cloud");
  const research = await make("Researcher", "google", "gemini-2.5-pro", ["research", "docs"], "cloud");
  const qa = await make("QA Runner", "anthropic", "claude-haiku-5-5", ["tests", "ci"], "MacBook Pro");

  const T = async (
    title: string,
    owner: string | null,
    column: (typeof tasks.$inferSelect)["column"],
    progressPct: number,
    priority: (typeof tasks.$inferSelect)["priority"],
    description: string,
    acceptanceCriteria = "",
  ) => {
    const t = await data.createTask({ title, ownerAgentId: owner, column, priority, description, acceptanceCriteria });
    await data.updateTask(t.id, { progressPct });
    return t;
  };

  const auth = await T("Build agent API key auth", backend.agent.id, "in_progress", 65, "high", "Per-agent tokens, hashed at rest, Bearer auth on /api/v1.", "401 on bad token, tests pass");
  const board = await T("Kanban drag and drop", frontend.agent.id, "in_progress", 40, "medium", "Drag cards between status columns.");
  const compare = await T("Compare MCP vs REST for agent reporting", research.agent.id, "review", 100, "medium", "Short write-up with a recommendation.");
  const e2e = await T("End-to-end tests for task flow", qa.agent.id, "waiting_on_you", 30, "high", "Claim → progress → review, against a seeded DB.");
  await T("Token usage chart per model", frontend.agent.id, "ready", 0, "low", "Stacked bars, tokens in and out.");
  await T("Deploy preview to the web", null, "backlog", 0, "medium", "Vercel + Turso. Needs your accounts.");
  await T("Database schema v1", backend.agent.id, "done", 100, "critical", "Agents, tasks, runs, events, messages.");
  await T("Pick a status color palette", frontend.agent.id, "done", 100, "low", "Match the Monday look.");

  // Activity
  const ev = (agentId: string, taskId: string, type: (typeof events.$inferSelect)["type"], payload: Record<string, unknown>) =>
    data.addEvent({ agentId, taskId, type, payload });
  await ev(backend.agent.id, auth.id, "file_edit", { path: "src/lib/tokens.ts", summary: "sha256 hashing and Bearer parsing" });
  await ev(backend.agent.id, auth.id, "tool_call", { tool: "npm test", summary: "12 passed" });
  await ev(backend.agent.id, auth.id, "note", { text: "Token rotation works, adding rate limits next" });
  await ev(frontend.agent.id, board.id, "file_edit", { path: "src/components/board/kanban-view.tsx", summary: "native drag events" });
  await ev(qa.agent.id, e2e.id, "error", { message: "Playwright: timeout waiting for 'Working on it' cell" });
  await ev(research.agent.id, compare.id, "note", { text: "Draft ready: REST for ingest, MCP as a thin wrapper" });

  // Chat between agents
  const say = (from: string | null, to: string | null, taskId: string | null, text: string) =>
    data.postMessage({ fromAgentId: from, toAgentId: to, taskId, text });
  await say(frontend.agent.id, backend.agent.id, auth.id, "What does the API return on a bad token? I want to show a clear error in the UI.");
  await say(backend.agent.id, frontend.agent.id, auth.id, "401 with {\"error\": \"Unknown agent token…\"}. Same shape for every error.");
  await say(research.agent.id, null, compare.id, "Write-up is in review. Short version: REST for reporting, MCP tools that call the same endpoints.");
  await say(qa.agent.id, backend.agent.id, e2e.id, "Can you seed a task in 'ready' for my test run? I need a stable id.");
  await say(null, qa.agent.id, e2e.id, "Use the seed script, it creates one in Ready.");

  // Usage
  const use = (agentId: string, model: string, taskId: string, tokensIn: number, tokensOut: number, costUsd: number) =>
    data.recordUsage(agentId, { model, taskId, tokensIn, tokensOut, costUsd });
  await use(backend.agent.id, "claude-opus-5-5", auth.id, 182_400, 21_300, 3.41);
  await use(backend.agent.id, "claude-opus-5-5", auth.id, 96_100, 12_800, 1.87);
  await use(frontend.agent.id, "gpt-5", board.id, 74_900, 18_200, 0.82);
  await use(research.agent.id, "gemini-2.5-pro", compare.id, 310_000, 9_400, 0.48);
  await use(qa.agent.id, "claude-haiku-5-5", e2e.id, 41_200, 6_100, 0.07);

  // One open approval
  await data.requestApproval(qa.agent.id, {
    taskId: e2e.id,
    action: "Reset the shared test database",
    reason: "Tests left stale rows. This deletes all rows in the test DB, not production.",
    risk: "medium",
  });

  // Make it look alive: recent heartbeats and current tasks.
  const now = Date.now();
  await data.heartbeat(backend.agent.id, { status: "active", currentTaskId: auth.id });
  await data.heartbeat(frontend.agent.id, { status: "active", currentTaskId: board.id });
  await data.heartbeat(research.agent.id, { status: "active", currentTaskId: compare.id });
  await db.update(agents).set({ lastHeartbeat: now - 2 * MIN, currentTaskId: e2e.id }).where(sql`${agents.id} = ${qa.agent.id}`);

  console.log("Seeded example data. Agent API keys (shown once):");
  for (const a of [backend, frontend, research, qa]) console.log(`  ${a.agent.name.padEnd(16)} ${a.token}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
