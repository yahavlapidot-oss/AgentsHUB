/**
 * Web tools: search the internet and read a page. Results come back marked as
 * outside content (see ../untrusted.ts). Search costs are added to the run.
 */
import { z } from "zod";
import { str, tool, ToolInputError, type AgentTool } from "../agent-tools";
import { addUsage } from "../data";
import { FetchPageError, fetchPage } from "../web/fetch-page";
import { SearchUnavailable, webSearch } from "../web/search";
import { markTainted, untrusted } from "../untrusted";

export const WEB_TOOLS: AgentTool[] = [
  tool({
    name: "web_search",
    description:
      "Search the internet. Returns titles, addresses and short snippets. Use it for anything current or that you aren't sure of, then read the best pages with fetch_page and cite the addresses you used.",
    inputSchema: {
      type: "object",
      properties: { query: str("What to search for, in the language that will find the best results"), count: { type: "number", description: "How many results (1-10, default 6)" } },
      required: ["query"],
    },
    args: z.object({ query: z.string().min(1).max(400), count: z.number().int().min(1).max(10).optional() }),
    run: async ({ query, count }, ctx) => {
      try {
        const answer = await webSearch(query, { count });
        if (ctx.runId && (answer.costUsd || answer.tokensIn)) {
          await addUsage(ctx.agent.id, ctx.runId, { tokensIn: answer.tokensIn, tokensOut: answer.tokensOut, costUsd: answer.costUsd });
        }
        markTainted(ctx.taint, "web search");
        return untrusted("web search", { query, results: answer.results, summary: answer.summary });
      } catch (e) {
        if (e instanceof SearchUnavailable) throw new ToolInputError(e.message);
        throw new ToolInputError(`Search failed: ${(e as Error).message}`);
      }
    },
  }),

  tool({
    name: "fetch_page",
    description:
      "Read a public web page (or a JSON/text address) as plain text, with its title and main links. Long pages are cut; ask for more with maxChars (up to 60000).",
    inputSchema: {
      type: "object",
      properties: { url: str("Full http(s) address"), maxChars: { type: "number", description: "Most characters of text to return (default 20000)" } },
      required: ["url"],
    },
    args: z.object({ url: z.string().min(1).max(2_000), maxChars: z.number().int().min(500).max(60_000).optional() }),
    run: async ({ url, maxChars }, ctx) => {
      try {
        const page = await fetchPage(url, { maxChars });
        markTainted(ctx.taint, new URL(page.url).hostname);
        return untrusted(page.url, page);
      } catch (e) {
        if (e instanceof FetchPageError) throw new ToolInputError(e.message);
        throw new ToolInputError(`Couldn't read the page: ${(e as Error).message}`);
      }
    },
  }),
];
