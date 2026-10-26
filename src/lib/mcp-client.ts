/**
 * A small MCP client (Streamable HTTP transport) so hosted agents can use tools
 * from any MCP server you add on the Connections page: Notion, Linear, Slack,
 * your own. Each server's tools become agent tools named mcp_<server>_<tool>.
 *
 * Tools the server marks read-only run freely; the rest ask you first unless
 * you set the connection to "never ask". Results come back as outside content.
 */
import { z } from "zod";
import { tool, ToolInputError, type AgentTool, type JsonSchema } from "./agent-tools";
import { connectionsFor } from "./connections";
import type { Connection } from "./schema";
import { markTainted, untrusted } from "./untrusted";
import { open } from "./vault";
import { askFirst } from "./tools/gate";

const PROTOCOL = "2025-06-18";
const TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS ?? 60_000);
const LIST_TTL_MS = 10 * 60_000;

export type McpToolInfo = { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string } };
export type McpApproval = "writes" | "always" | "never";

type RpcResponse = { jsonrpc: "2.0"; id?: number | string; result?: unknown; error?: { code: number; message: string } };

export class McpSession {
  private id = 0;
  private sessionId: string | null = null;
  private ready: Promise<void> | null = null;

  constructor(
    private url: string,
    private headers: Record<string, string>,
  ) {}

  private async post(body: Record<string, unknown>): Promise<RpcResponse | null> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL,
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (res.status === 202 || res.status === 204) return null;
    if (!res.ok) throw new Error(`MCP server answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const type = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (type.includes("text/event-stream")) {
      // The answer is one of the stream's events: the one with our id.
      const events = text
        .split(/\r?\n\r?\n/)
        .map((block) => block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n"))
        .filter(Boolean);
      for (const e of events) {
        try {
          const msg = JSON.parse(e) as RpcResponse;
          if (msg.id === body.id) return msg;
        } catch {
          // Not JSON; skip.
        }
      }
      throw new Error("The MCP server's stream had no answer");
    }
    return JSON.parse(text) as RpcResponse;
  }

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await this.post({ jsonrpc: "2.0", id: ++this.id, method, ...(params ? { params } : {}) });
    if (!res) throw new Error(`No answer to ${method}`);
    if (res.error) throw new Error(`MCP ${method}: ${res.error.message}`);
    return res.result as T;
  }

  private init(): Promise<void> {
    this.ready ??= (async () => {
      await this.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "AgentsHUB", version: "1.0" } });
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })();
    return this.ready;
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.init();
    const out: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await this.request<{ tools: McpToolInfo[]; nextCursor?: string }>("tools/list", cursor ? { cursor } : {});
      out.push(...r.tools);
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return out;
  }

  async callTool(name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
    await this.init();
    const r = await this.request<{ content?: { type: string; text?: string; resource?: { text?: string; uri?: string } }[]; structuredContent?: unknown; isError?: boolean }>("tools/call", {
      name,
      arguments: args ?? {},
    });
    const parts = (r.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : c.type === "resource" ? c.resource?.text ?? c.resource?.uri ?? "" : `[${c.type} content not shown]`));
    if (!parts.length && r.structuredContent) parts.push(JSON.stringify(r.structuredContent));
    return { text: parts.join("\n").slice(0, 50_000), isError: Boolean(r.isError) };
  }
}

/** The address and headers a connection's secret and meta describe. */
export function sessionFor(c: Connection): McpSession {
  const url = String(c.meta.url ?? "");
  if (!/^https:\/\//.test(url) && !(process.env.NODE_ENV !== "production" && /^http:\/\//.test(url))) throw new Error("MCP servers need an https address");
  const secret = open(c.secret);
  let headers: Record<string, string> = {};
  if (secret) {
    // The secret is either a bearer token or a JSON object of headers.
    try {
      const parsed = JSON.parse(secret);
      headers = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      headers = { authorization: secret.startsWith("Bearer ") ? secret : `Bearer ${secret}` };
    }
  }
  return new McpSession(url, headers);
}

const listCache = new Map<string, { at: number; tools: McpToolInfo[] }>();

export async function listServerTools(c: Connection): Promise<McpToolInfo[]> {
  const key = `${c.id}:${c.updatedAt}`;
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.tools;
  const tools = await sessionFor(c).listTools();
  listCache.set(key, { at: Date.now(), tools });
  return tools;
}

export function slug(s: string, max = 20): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max) || "server";
}

/** A JSON Schema every provider accepts: an object with properties. */
function cleanSchema(schema: Record<string, unknown> | undefined): JsonSchema {
  const s = schema && schema.type === "object" ? schema : { type: "object", properties: {} };
  const { $schema: _drop, additionalProperties: _ap, ...rest } = s as Record<string, unknown>;
  return { ...(rest as JsonSchema), type: "object", properties: (rest.properties as Record<string, unknown>) ?? {} };
}

function needsApproval(t: McpToolInfo, mode: McpApproval): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  return !t.annotations?.readOnlyHint;
}

/** Agent tools for every MCP server this agent may use. A server that can't be reached is skipped. */
export async function mcpToolsFor(agentId: string): Promise<{ tools: AgentTool[]; problems: string[] }> {
  const servers = await connectionsFor(agentId, "mcp");
  const tools: AgentTool[] = [];
  const problems: string[] = [];
  const taken = new Set<string>();
  for (const c of servers) {
    let list: McpToolInfo[];
    try {
      list = await listServerTools(c);
    } catch (e) {
      problems.push(`${c.label}: ${(e as Error).message}`);
      continue;
    }
    const mode = (c.meta.approval as McpApproval) ?? "writes";
    const prefix = `mcp_${slug(c.label)}_`;
    for (const t of list.slice(0, 60)) {
      let name = `${prefix}${slug(t.name, 64 - prefix.length)}`;
      for (let i = 2; taken.has(name); i++) name = `${name.slice(0, 60)}_${i}`;
      taken.add(name);
      tools.push(
        tool({
          name,
          description: `[${c.label} MCP server] ${t.description ?? t.annotations?.title ?? t.name}`.slice(0, 1_000),
          inputSchema: cleanSchema(t.inputSchema),
          args: z.unknown(),
          run: async (args, ctx) => {
            if (needsApproval(t, mode) || ctx.taint?.tainted) {
              const asked = await askFirst(ctx, {
                action: `${c.label} (MCP): ${t.name} ${JSON.stringify(args ?? {}).slice(0, 300)}`,
                service: c.label,
                details: JSON.stringify(args ?? {}, null, 2).slice(0, 10_000),
                alwaysAsk: needsApproval(t, mode),
              });
              if (!asked.ok) return asked.refused;
            }
            let out: { text: string; isError: boolean };
            try {
              out = await sessionFor(c).callTool(t.name, args);
            } catch (e) {
              throw new ToolInputError(`${c.label}: ${(e as Error).message}`);
            }
            if (out.isError) throw new ToolInputError(`${c.label}: ${out.text.slice(0, 2_000)}`);
            markTainted(ctx.taint, c.label);
            return untrusted(c.label, out.text);
          },
        }),
      );
    }
  }
  return { tools, problems };
}
