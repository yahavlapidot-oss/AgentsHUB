/**
 * Fills a fresh database for the browser tests: an agent at work with a cloud
 * computer and command output, a second agent, a pending approval, and files
 * in two projects. Writes the agent's API key to e2e/.state.json.
 */
import { writeFileSync } from "node:fs";
import * as d from "../src/lib/data.ts";

const { agent: coder, token } = await d.createAgent({ name: "Coder", provider: "anthropic", model: "claude-sonnet-5-5", kind: "hosted", sandboxEnabled: true });
const { agent: writer } = await d.createAgent({ name: "Writer", provider: "openai", model: "gpt-5", kind: "sdk" });

const shop = await d.createProject({ name: "Shop", goal: "Online store" });
const docs = await d.createProject({ name: "Docs site" });
const task = await d.createTask({ title: "Add invoice PDF export", projectId: shop.id, ownerAgentId: coder.id, column: "in_progress" });
const docTask = await d.createTask({ title: "Write the guide", projectId: docs.id, ownerAgentId: writer.id });

const run = await d.startRun(coder.id, { taskId: task.id, model: "claude-sonnet-5-5" });
await d.addUsage(coder.id, run.id, { tokensIn: 12_000, tokensOut: 900, costUsd: 0.25 });
await d.heartbeat(coder.id, { status: "active", currentTaskId: task.id, model: "claude-sonnet-5-5" });
const box = await d.createSandboxRecord({ agentId: coder.id, taskId: task.id, runId: run.id, provider: "e2b" });
await d.updateSandboxRecord(box.id, { status: "running", addCommands: 1 });
await d.addEvent({ agentId: coder.id, taskId: task.id, runId: run.id, type: "tool_call", payload: { tool: "run_command", text: "$ npm test → exit 1", output: "Tests: 1 failed, 11 passed" } });

await d.saveArtifact({ taskId: task.id, agentId: coder.id, path: "src/invoice.ts", content: Buffer.from("export const total = 1;\n") });
await d.saveArtifact({ taskId: docTask.id, agentId: writer.id, path: "guide.md", content: Buffer.from("# Guide\n") });

await d.requestApproval(writer.id, { action: "Send the launch email to 240 customers", reason: "The task asks for it", risk: "medium" });

writeFileSync(new URL("./.state.json", import.meta.url), JSON.stringify({ token, coderId: coder.id }));
console.log("[e2e] seeded");
