import type { Provider } from "./schema";

/** Copy-paste code shown after connecting an agent. */
export function connectSnippets(baseUrl: string, token: string, provider: Provider, model: string) {
  const hub = `const HUB = "${baseUrl}/api/v1";
const HUB_TOKEN = process.env.AGENTSHUB_TOKEN!; // ${token.slice(0, 9)}…

async function hub(path: string, body?: unknown, method = body ? "POST" : "GET") {
  const res = await fetch(HUB + path, {
    method,
    headers: { authorization: \`Bearer \${HUB_TOKEN}\`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(\`AgentsHUB \${res.status}: \${await res.text()}\`);
  return res.json();
}`;

  const flow = `// 1. Say hello and pick up any commands from the board.
const { commands } = await hub("/heartbeat", { status: "active" });

// 2. Claim a task assigned to you.
const { tasks } = await hub("/tasks?mine=1&column=ready");
const task = tasks[0];
if (task) await hub(\`/tasks/\${task.id}/claim\`, {});`;

  const call: Record<Provider, string> = {
    anthropic: `import Anthropic from "@anthropic-ai/sdk";
const claude = new Anthropic();

const msg = await claude.messages.create({
  model: "${model}",
  max_tokens: 1024,
  messages: [{ role: "user", content: task?.description ?? "Hello" }],
});
await hub("/usage", {
  model: msg.model,
  taskId: task?.id,
  tokensIn: msg.usage.input_tokens,
  tokensOut: msg.usage.output_tokens,
});`,
    openai: `import OpenAI from "openai";
const openai = new OpenAI();

const res = await openai.responses.create({
  model: "${model}",
  input: task?.description ?? "Hello",
});
await hub("/usage", {
  model: res.model,
  taskId: task?.id,
  tokensIn: res.usage?.input_tokens ?? 0,
  tokensOut: res.usage?.output_tokens ?? 0,
});`,
    google: `import { GoogleGenAI } from "@google/genai";
const gemini = new GoogleGenAI({});

const res = await gemini.models.generateContent({
  model: "${model}",
  contents: task?.description ?? "Hello",
});
await hub("/usage", {
  model: "${model}",
  taskId: task?.id,
  tokensIn: res.usageMetadata?.promptTokenCount ?? 0,
  tokensOut: res.usageMetadata?.candidatesTokenCount ?? 0,
});`,
    custom: `// Call your model, then report what it used:
await hub("/usage", { model: "${model}", taskId: task?.id, tokensIn: 1200, tokensOut: 350 });`,
  };

  const report = `// 3. Report progress, talk to other agents, ask before risky steps.
if (task) {
  await hub(\`/tasks/\${task.id}/progress\`, { progressPct: 50, note: "Halfway there" });
  await hub("/messages", { text: "Picking up the API part", taskId: task.id });
  await hub("/approvals", { action: "Deploy to production", risk: "high", taskId: task.id });
  await hub(\`/tasks/\${task.id}/progress\`, { column: "review", progressPct: 100 });
}`;

  const curl = `export AGENTSHUB_TOKEN=${token}

curl -X POST ${baseUrl}/api/v1/heartbeat \\
  -H "Authorization: Bearer $AGENTSHUB_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"active"}'`;

  return { curl, code: `${hub}\n\n${flow}\n\n${call[provider]}\n\n${report}` };
}

/** Setup for agents that speak MCP: Claude Code (plus hooks) and Codex. */
export function mcpSnippets(baseUrl: string, token: string) {
  const mcpUrl = `${baseUrl}/api/mcp`;

  const claudeMcp = `claude mcp add --transport http agentshub ${mcpUrl} \\
  --header "Authorization: Bearer ${token}"`;

  const hookCommand = "node ~/.claude/agentshub-hook.mjs";
  const hook = (timeout?: number) => [{ type: "command", command: hookCommand, ...(timeout ? { timeout } : {}) }];
  const claudeHooks = JSON.stringify(
    {
      env: { AGENTSHUB_URL: baseUrl, AGENTSHUB_TOKEN: token },
      hooks: {
        SessionStart: [{ hooks: hook() }],
        UserPromptSubmit: [{ hooks: hook() }],
        // Long timeout: the hook waits here while you approve or deny on the board.
        PreToolUse: [{ matcher: "*", hooks: hook(660) }],
        PostToolUse: [{ matcher: "*", hooks: hook() }],
        Stop: [{ hooks: hook() }],
      },
    },
    null,
    2,
  );

  const hookInstall = `curl -fsSL ${baseUrl}/agentshub-hook.mjs -o ~/.claude/agentshub-hook.mjs`;

  const codex = `# ~/.codex/config.toml
[mcp_servers.agentshub]
url = "${mcpUrl}"
bearer_token_env_var = "AGENTSHUB_TOKEN"

# and in your shell profile:
# export AGENTSHUB_TOKEN=${token}`;

  return { claudeMcp, claudeHooks, hookInstall, codex };
}
