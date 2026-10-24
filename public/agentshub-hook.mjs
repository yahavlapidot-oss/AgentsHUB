#!/usr/bin/env node
/**
 * AgentsHUB hook for Claude Code. One script handles every hook event:
 *
 *   SessionStart      marks the agent online
 *   UserPromptSubmit  logs that a new prompt started
 *   PreToolUse        obeys pause/stop from the board and asks for approval
 *                     before irreversible, money or publishing actions
 *   PostToolUse       logs the tool call, and passes your redirect
 *                     instructions and new chat messages to Claude
 *   Stop              reports the session's tokens from the transcript
 *
 * Needs Node 18+ and two environment variables:
 *   AGENTSHUB_URL    e.g. https://agentshub.up.railway.app
 *   AGENTSHUB_TOKEN  the agent's API key (ahub_...)
 * Optional: AGENTSHUB_APPROVAL_WAIT  seconds to wait for a decision (default 600)
 *
 * The board is never allowed to break Claude Code: if it can't be reached, the
 * hook logs to stderr and lets the action through.
 */
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const BASE = (process.env.AGENTSHUB_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.AGENTSHUB_TOKEN || "";
const WAIT_S = Number(process.env.AGENTSHUB_APPROVAL_WAIT || 600);
const POLL_MS = 4000;
const FILE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

async function main() {
  if (!BASE || !TOKEN) return; // not configured: do nothing
  const input = JSON.parse(await readStdin() || "{}");
  const state = loadState(input.session_id);
  try {
    switch (input.hook_event_name) {
      case "SessionStart":
        await hub("/heartbeat", { status: "active" });
        break;
      case "UserPromptSubmit":
        await hub("/heartbeat", { status: "active" });
        await hub("/events", { type: "note", payload: { text: `New prompt: ${clip(input.prompt, 300)}` } });
        break;
      case "PreToolUse":
        return await preToolUse(input, state);
      case "PostToolUse":
        return await postToolUse(input, state);
      case "Stop":
      case "SubagentStop":
        await reportUsage(input, state);
        await hub("/heartbeat", { status: "active", currentTaskId: null });
        break;
    }
  } finally {
    saveState(input.session_id, state);
  }
}

async function preToolUse(input, state) {
  await handleCommands(await hub("/heartbeat", { status: "active" }), state);
  if (state.stopped) return deny("The user stopped you from AgentsHUB. Stop working now and summarize where you got to.");
  while (state.paused) {
    await sleep(POLL_MS);
    await handleCommands(await hub("/heartbeat", {}), state);
    if (state.stopped) return deny("The user stopped you from AgentsHUB. Stop working now and summarize where you got to.");
  }

  let gate = await hub("/policy/check", { tool: input.tool_name, input: input.tool_input });
  if (!gate) return; // board unreachable: don't block
  const deadline = Date.now() + WAIT_S * 1000;
  while (gate.decision === "ask" || gate.decision === "paused") {
    if (Date.now() > deadline) {
      return deny(`Waiting for approval in AgentsHUB timed out. The action "${gate.action}" was not run. Ask the user to approve it on the board, then try again.`);
    }
    process.stderr.write(`[agentshub] waiting for your approval on the board: ${gate.action}\n`);
    await sleep(POLL_MS);
    await handleCommands(await hub("/heartbeat", { status: "waiting" }), state);
    if (state.stopped) return deny("The user stopped you from AgentsHUB. Stop working now and summarize where you got to.");
    gate = await hub("/policy/check", { tool: input.tool_name, input: input.tool_input });
    if (!gate) return;
  }
  if (gate.decision === "deny") {
    return deny(`The user denied this action in AgentsHUB: "${gate.action}". Don't retry it; find another way or ask them.`);
  }
  // allow: fall through to Claude Code's own permission rules.
}

async function postToolUse(input, state) {
  const type = FILE_TOOLS.has(input.tool_name) ? "file_edit" : "tool_call";
  await hub("/events", {
    type,
    payload: {
      tool: input.tool_name,
      text: summarize(input.tool_name, input.tool_input),
      ok: !(input.tool_response && input.tool_response.is_error),
    },
  });

  const since = state.inboxSince || Date.now() - 10 * 60_000;
  const inbox = await hub("/messages?since=" + since);
  state.inboxSince = Date.now();
  const notes = [...(state.redirects || [])];
  state.redirects = [];
  for (const m of inbox?.messages || []) {
    notes.push(`Message on AgentsHUB from ${m.fromAgentId ? `agent ${m.fromAgentId}` : "the user"}: ${m.text}`);
  }
  if (notes.length) {
    out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: notes.join("\n") } });
  }
}

async function handleCommands(res, state) {
  for (const c of res?.commands || []) {
    if (c.type === "pause") state.paused = true;
    if (c.type === "resume") state.paused = false;
    if (c.type === "stop") state.stopped = true;
    if (c.type === "redirect" && c.text) (state.redirects ||= []).push(`The user redirected you from AgentsHUB: ${c.text}`);
    await hub(`/commands/${c.id}/ack`, {});
  }
  // A resume clears an earlier stop too, so the next prompt can work again.
  if ((res?.commands || []).some((c) => c.type === "resume")) state.stopped = false;
}

/** Sums the usage of assistant messages in the transcript that weren't reported yet. */
async function reportUsage(input, state) {
  if (!input.transcript_path || !existsSync(input.transcript_path)) return;
  const seen = new Set(state.reported || []);
  const totals = new Map(); // model -> {in, out}
  const lines = createInterface({ input: createReadStream(input.transcript_path), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = entry && entry.message;
    if (!msg || !msg.usage || !msg.id || seen.has(msg.id)) continue;
    seen.add(msg.id);
    const u = msg.usage;
    const t = totals.get(msg.model) || { in: 0, out: 0 };
    t.in += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    t.out += u.output_tokens || 0;
    totals.set(msg.model, t);
  }
  state.reported = [...seen].slice(-5000);
  for (const [model, t] of totals) {
    if (!t.in && !t.out) continue;
    await hub("/usage", { model: model || "claude-code", tokensIn: t.in, tokensOut: t.out });
    await hub("/heartbeat", { model });
  }
}

// ---------------------------------------------------------------- helpers

async function hub(path, body) {
  try {
    const res = await fetch(BASE + "/api/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      process.stderr.write(`[agentshub] ${path} -> ${res.status} ${clip(await res.text(), 200)}\n`);
      return null;
    }
    return await res.json();
  } catch (e) {
    process.stderr.write(`[agentshub] ${path} failed: ${e.message}\n`);
    return null;
  }
}

function deny(reason) {
  out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function summarize(tool, input) {
  if (!input) return tool;
  if (input.command) return clip(input.command, 300);
  if (input.file_path) return input.file_path;
  if (input.pattern) return `${tool} ${input.pattern}`;
  if (input.url) return input.url;
  return clip(JSON.stringify(input), 300);
}

function clip(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function statePath(sessionId) {
  return join(tmpdir(), `agentshub-${String(sessionId || "default").replace(/[^\w-]/g, "")}.json`);
}

function loadState(sessionId) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return {};
  }
}

function saveState(sessionId, state) {
  try {
    writeFileSync(statePath(sessionId), JSON.stringify(state));
  } catch {}
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  process.stderr.write(`[agentshub] hook error: ${e.message}\n`);
});
