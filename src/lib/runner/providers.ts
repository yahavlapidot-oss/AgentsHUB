/**
 * One chat loop per provider, behind the same small interface, so the runner
 * doesn't care whether an agent is Claude, GPT or Gemini. Each adapter keeps its
 * own conversation history in the provider's native shape, and shortens old
 * tool outputs in it once it grows past the context budget (see ../context.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import OpenAI from "openai";
import type { AgentTool } from "../agent-tools";
import { estimateTokens, HISTORY_TOKENS, isTrimmed, KEEP_RECENT, trimmedOutput } from "../context";
import type { Provider } from "../schema";

export type ToolCall = { id: string; name: string; args: unknown };
export type ToolOutput = { id: string; name: string; output: string; isError?: boolean };

export type Turn = {
  text: string;
  toolCalls: ToolCall[];
  usage: { tokensIn: number; tokensOut: number };
  /** The model that actually answered (a fallback may differ from the one asked for). */
  model: string;
  /** Set when the provider stopped for a reason other than finishing or calling tools. */
  stopProblem?: string;
};

export interface Chat {
  /** First call: the task brief. Later calls: tool outputs, optionally with a note from the user. */
  send(input: { text?: string; toolOutputs?: ToolOutput[] }): Promise<Turn>;
}

export type ChatOptions = { provider: Provider; model: string; system: string; tools: AgentTool[] };

export class MissingKeyError extends Error {}

export function createChat(opts: ChatOptions): Chat {
  switch (opts.provider) {
    case "anthropic":
      return new ClaudeChat(opts);
    case "openai":
      return new OpenAIChat(opts);
    case "google":
      return new GeminiChat(opts);
    default:
      throw new Error(`Hosted agents need a Claude, GPT or Gemini model, not "${opts.provider}"`);
  }
}

/** Which API key each provider needs. */
export const PROVIDER_KEYS: Record<Exclude<Provider, "custom">, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
};

function requireKey(provider: Exclude<Provider, "custom">): string {
  const name = PROVIDER_KEYS[provider];
  const key = process.env[name];
  if (!key) throw new MissingKeyError(`Set ${name} on the server to run ${provider} agents`);
  return key;
}

// ---------------------------------------------------------------- Claude

/** Models that accept the server-side refusal fallback. */
const CLAUDE_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

class ClaudeChat implements Chat {
  private client: Anthropic;
  private messages: Anthropic.Beta.BetaMessageParam[] = [];
  constructor(private opts: ChatOptions) {
    this.client = new Anthropic({ apiKey: requireKey("anthropic") });
  }

  async send(input: { text?: string; toolOutputs?: ToolOutput[] }): Promise<Turn> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const o of input.toolOutputs ?? []) {
      content.push({ type: "tool_result", tool_use_id: o.id, content: o.output, is_error: o.isError || undefined });
    }
    if (input.text) content.push({ type: "text", text: input.text });
    this.messages.push({ role: "user", content });
    compactClaudeMessages(this.messages);

    const fallback = CLAUDE_FALLBACK_MODELS.has(this.opts.model);
    const res = await this.client.beta.messages.create({
      model: this.opts.model,
      max_tokens: 16000,
      system: this.opts.system,
      tools: this.opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      })),
      messages: this.messages,
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    // Keep the whole content (thinking and tool_use blocks included) for the next request.
    this.messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });

    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const block of res.content) {
      if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, args: block.input });
      else if (block.type === "text") text += block.text;
    }
    const stopProblem =
      res.stop_reason === "refusal"
        ? "The model declined this request"
        : res.stop_reason === "max_tokens" && !toolCalls.length
          ? "The model ran out of output tokens"
          : undefined;
    return {
      text,
      toolCalls,
      model: res.model,
      usage: { tokensIn: totalInput(res.usage), tokensOut: res.usage.output_tokens },
      stopProblem,
    };
  }
}

function totalInput(u: Anthropic.Beta.BetaUsage): number {
  return u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}

// ---------------------------------------------------------------- GPT (OpenAI Responses API)

class OpenAIChat implements Chat {
  private client: OpenAI;
  private previousId: string | null = null;
  constructor(private opts: ChatOptions) {
    this.client = new OpenAI({ apiKey: requireKey("openai") });
  }

  async send(input: { text?: string; toolOutputs?: ToolOutput[] }): Promise<Turn> {
    const items: OpenAI.Responses.ResponseInputItem[] = [];
    for (const o of input.toolOutputs ?? []) {
      items.push({ type: "function_call_output", call_id: o.id, output: o.isError ? `Error: ${o.output}` : o.output });
    }
    if (input.text) items.push({ role: "user", content: input.text });

    const res = await this.client.responses.create({
      model: this.opts.model,
      instructions: this.opts.system,
      input: items,
      previous_response_id: this.previousId,
      // OpenAI keeps the history; past the model's window it drops the oldest items.
      truncation: "auto",
      tools: this.opts.tools.map((t) => ({
        type: "function" as const,
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
        strict: false,
      })),
    });
    this.previousId = res.id;

    const toolCalls: ToolCall[] = [];
    for (const item of res.output) {
      if (item.type === "function_call") toolCalls.push({ id: item.call_id, name: item.name, args: safeJson(item.arguments) });
    }
    const stopProblem =
      res.status === "incomplete" ? `The response was cut off (${res.incomplete_details?.reason ?? "unknown"})` : undefined;
    return {
      text: res.output_text ?? "",
      toolCalls,
      model: res.model,
      usage: { tokensIn: res.usage?.input_tokens ?? 0, tokensOut: res.usage?.output_tokens ?? 0 },
      stopProblem,
    };
  }
}

// ---------------------------------------------------------------- Gemini

class GeminiChat implements Chat {
  private client: GoogleGenAI;
  private contents: Content[] = [];
  private callSeq = 0;
  constructor(private opts: ChatOptions) {
    this.client = new GoogleGenAI({ apiKey: requireKey("google") });
  }

  async send(input: { text?: string; toolOutputs?: ToolOutput[] }): Promise<Turn> {
    const parts: NonNullable<Content["parts"]> = [];
    for (const o of input.toolOutputs ?? []) {
      parts.push({
        functionResponse: {
          id: o.id.startsWith("gemini_") ? undefined : o.id,
          name: o.name,
          response: o.isError ? { error: o.output } : { output: o.output },
        },
      });
    }
    if (input.text) parts.push({ text: input.text });
    this.contents.push({ role: "user", parts });
    compactGeminiContents(this.contents);

    const res = await this.client.models.generateContent({
      model: this.opts.model,
      contents: this.contents,
      config: {
        systemInstruction: this.opts.system,
        tools: [
          {
            functionDeclarations: this.opts.tools.map(
              (t): FunctionDeclaration => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema }),
            ),
          },
        ],
      },
    });
    const reply = res.candidates?.[0]?.content;
    // The model's own turn (with any thought signatures) has to go back unchanged.
    if (reply) this.contents.push({ role: "model", parts: reply.parts ?? [] });

    const toolCalls: ToolCall[] = (res.functionCalls ?? []).map((c) => ({
      id: c.id ?? `gemini_${++this.callSeq}`,
      name: c.name ?? "",
      args: c.args ?? {},
    }));
    const finish = res.candidates?.[0]?.finishReason;
    const stopProblem =
      finish && finish !== "STOP" && !toolCalls.length ? `Gemini stopped early (${finish})` : res.candidates?.length ? undefined : "Gemini returned no answer";
    return {
      text: res.text ?? "",
      toolCalls,
      model: res.modelVersion ?? this.opts.model,
      usage: {
        tokensIn: res.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0),
      },
      stopProblem,
    };
  }
}

// ---------------------------------------------------------------- shortening old tool outputs

/**
 * Shortens tool results older than the last few messages while the history is
 * over budget. Only tool outputs change: the model's own turns (thinking and
 * signatures included) and the brief stay as they were.
 */
export function compactClaudeMessages(messages: Anthropic.Beta.BetaMessageParam[], maxTokens = HISTORY_TOKENS): number {
  let size = estimateTokens(JSON.stringify(messages));
  let trimmed = 0;
  for (let i = 0; i < messages.length - KEEP_RECENT && size > maxTokens; i++) {
    const m = messages[i];
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const block of m.content) {
      if (block.type !== "tool_result" || typeof block.content !== "string" || isTrimmed(block.content)) continue;
      const short = trimmedOutput(block.content);
      if (short === block.content) continue;
      size -= estimateTokens(block.content) - estimateTokens(short);
      block.content = short;
      trimmed++;
    }
  }
  return trimmed;
}

export function compactGeminiContents(contents: Content[], maxTokens = HISTORY_TOKENS): number {
  let size = estimateTokens(JSON.stringify(contents));
  let trimmed = 0;
  for (let i = 0; i < contents.length - KEEP_RECENT && size > maxTokens; i++) {
    const c = contents[i];
    if (c.role !== "user") continue;
    for (const part of c.parts ?? []) {
      const res = part.functionResponse?.response as { output?: unknown; error?: unknown } | undefined;
      if (!res) continue;
      for (const key of ["output", "error"] as const) {
        const value = res[key];
        if (typeof value !== "string" || isTrimmed(value)) continue;
        const short = trimmedOutput(value);
        if (short === value) continue;
        size -= estimateTokens(value) - estimateTokens(short);
        res[key] = short;
        trimmed++;
      }
    }
  }
  return trimmed;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
