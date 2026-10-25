/**
 * Web search for agents, behind one function whatever answers it:
 *   TAVILY_API_KEY  → Tavily (1,000 free searches a month)
 *   BRAVE_SEARCH_API_KEY → Brave Search API
 *   otherwise ANTHROPIC_API_KEY → Claude's built-in web search, run by a small
 *     model (WEB_SEARCH_MODEL, default claude-haiku-5-5): about $10 per 1,000
 *     searches plus a few cents of tokens.
 * WEB_SEARCH_PROVIDER=tavily|brave|claude picks one when several keys are set.
 */
import Anthropic from "@anthropic-ai/sdk";
import { costUsd } from "../pricing";

export type SearchResult = { title: string; url: string; snippet: string; age?: string };
export type SearchAnswer = { provider: string; results: SearchResult[]; summary?: string; costUsd: number; tokensIn: number; tokensOut: number };

export class SearchUnavailable extends Error {}

/** USD per search on top of tokens, for Claude's web search. */
const CLAUDE_SEARCH_USD = 0.01;

export function searchProvider(): "tavily" | "brave" | "claude" | null {
  const forced = process.env.WEB_SEARCH_PROVIDER;
  if (forced === "tavily" && process.env.TAVILY_API_KEY) return "tavily";
  if (forced === "brave" && process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (forced === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

export async function webSearch(query: string, opts: { count?: number } = {}): Promise<SearchAnswer> {
  const count = Math.min(Math.max(opts.count ?? 6, 1), 10);
  const provider = searchProvider();
  if (provider === "tavily") return tavily(query, count);
  if (provider === "brave") return brave(query, count);
  if (provider === "claude") return claude(query, count);
  throw new SearchUnavailable("Web search isn't set up on the server (set TAVILY_API_KEY, BRAVE_SEARCH_API_KEY or ANTHROPIC_API_KEY)");
}

async function tavily(query: string, count: number): Promise<SearchAnswer> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query, max_results: count, search_depth: "basic" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { results?: { title?: string; url: string; content?: string; published_date?: string }[] };
  return {
    provider: "tavily",
    results: (body.results ?? []).map((r) => ({ title: r.title ?? r.url, url: r.url, snippet: (r.content ?? "").slice(0, 500), age: r.published_date })),
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
}

async function brave(query: string, count: number): Promise<SearchAnswer> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: { "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY!, accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Brave search failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string; age?: string }[] } };
  return {
    provider: "brave",
    results: (body.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: stripTags(r.description ?? ""), age: r.age })),
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
}

async function claude(query: string, count: number): Promise<SearchAnswer> {
  const model = process.env.WEB_SEARCH_MODEL || "claude-haiku-5-5";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
    messages: [
      {
        role: "user",
        content: `Search the web for: ${query}\n\nThen give the ${count} most useful results, each as "- <title> | <url> | <one or two sentences on what it says about the query>". No other text.`,
      },
    ],
  });
  const results: SearchResult[] = [];
  let text = "";
  for (const block of res.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) results.push({ title: r.title, url: r.url, snippet: "", age: r.page_age ?? undefined });
    } else if (block.type === "text") text += block.text;
  }
  // The model's lines carry the snippets; match them back to the results by address.
  for (const line of text.split("\n")) {
    const [, url, snippet] = line.replace(/^\s*[-*]\s*/, "").split(" | ");
    const hit = url && results.find((r) => r.url === url.trim());
    if (hit && snippet) hit.snippet = snippet.trim();
  }
  const searches = res.usage.server_tool_use?.web_search_requests ?? 0;
  const tokensIn = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
  return {
    provider: "claude",
    results: results.slice(0, count),
    summary: results.length ? undefined : text.slice(0, 3_000),
    costUsd: costUsd(model, tokensIn, res.usage.output_tokens) + searches * CLAUDE_SEARCH_USD,
    tokensIn,
    tokensOut: res.usage.output_tokens,
  };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}
