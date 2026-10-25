import { NextResponse, type NextRequest } from "next/server";
import { MAX_BODY_BYTES, readJson, TooLarge } from "@/lib/api";
import { findTool, ToolInputError } from "@/lib/agent-tools";
import { toolsForAgent } from "@/lib/tool-hub";
import { ConflictError, findAgentByToken, heartbeat } from "@/lib/data";
import { bearerToken } from "@/lib/tokens";

/**
 * MCP server for agents that run outside AgentsHUB (Claude Code, Codex, Cursor,
 * Gemini CLI...). Streamable HTTP transport in its stateless form: every request
 * is a JSON-RPC POST answered with JSON. Auth is the agent's own API key.
 *
 *   claude mcp add --transport http agentshub https://<host>/api/mcp \
 *     --header "Authorization: Bearer ahub_..."
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const INSTRUCTIONS = `You are connected to AgentsHUB, the board where your user tracks and directs agents.
- At the start, call list_tasks (mine=true, then column='ready') and claim_task before working.
- Split big tasks with create_subtasks; hand pieces to other agents (list_agents) when they fit better.
- Call report_progress after each meaningful step, and check_inbox between steps to pick up the user's commands and messages.
- Coordinate with other agents through send_message, so the user can follow the conversation.
- Before anything irreversible, anything involving money, or anything that publishes or sends something outside, call request_approval and wait for 'allow'.
- When done, call complete_task with a summary.`;

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

export async function POST(req: NextRequest): Promise<Response> {
  const token = bearerToken(req.headers.get("authorization"));
  const agent = token ? await findAgentByToken(token) : null;
  if (!agent) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or unknown agent API key (Authorization: Bearer ahub_...)" } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await readJson(req);
  } catch (e) {
    if (e instanceof TooLarge) {
      return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Request is over ${MAX_BODY_BYTES} bytes` } }, { status: 413 });
    }
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const batch = Array.isArray(body);
  const requests = (batch ? body : [body]) as RpcRequest[];
  const responses = [];
  for (const r of requests) {
    const res = await handle(r, agent);
    if (res) responses.push(res);
  }
  // Notifications and responses only: nothing to send back.
  if (!responses.length) return new Response(null, { status: 202 });
  return NextResponse.json(batch ? responses : responses[0]);
}

export function GET(): Response {
  // This server never starts conversations, so there is no event stream to open.
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

async function handle(r: RpcRequest, agent: NonNullable<Awaited<ReturnType<typeof findAgentByToken>>>) {
  if (!r || typeof r.method !== "string") {
    return { jsonrpc: "2.0", id: r?.id ?? null, error: { code: -32600, message: "Invalid request" } };
  }
  const isNotification = r.id === undefined;
  if (isNotification) return null;

  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: r.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: r.id, error: { code, message } });

  switch (r.method) {
    case "initialize": {
      const asked = String(r.params?.protocolVersion ?? "");
      await heartbeat(agent.id, {});
      return reply({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "agentshub", title: "AgentsHUB", version: "0.2.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        // Outside agents bring their own machine, so they never get the sandbox tools.
        tools: toolsForAgent(agent, { sandbox: false }).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call": {
      const name = String(r.params?.name ?? "");
      const tool = findTool(name, toolsForAgent(agent, { sandbox: false }));
      if (!tool) {
        return agent.disabledTools.includes(name)
          ? reply({ content: [{ type: "text", text: `${name} is turned off for this agent on AgentsHUB` }], isError: true })
          : fail(-32602, `Unknown tool: ${name}`);
      }
      try {
        const result = await tool.run(r.params?.arguments ?? {}, { agent });
        return reply({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: asObject(result) });
      } catch (e) {
        // Tool failures go back to the model as results it can read and react to.
        const message =
          e instanceof ToolInputError || e instanceof ConflictError ? e.message : "The board hit an internal error";
        if (!(e instanceof ToolInputError || e instanceof ConflictError)) console.error(e);
        return reply({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${r.method}`);
  }
}

function asObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
