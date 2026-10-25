import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { Content } from "@google/genai";
import { beforeAll, describe, expect, it } from "vitest";
import { estimateTokens, fitSections, isTrimmed } from "../src/lib/context";
import { rankDocs, type MemoryDoc } from "../src/lib/memory";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-mem-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let tools: typeof import("../src/lib/agent-tools");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  tools = await import("../src/lib/agent-tools");
});

const doc = (id: string, title: string, text: string, at = Date.now()): MemoryDoc => ({ source: "team_note", id, title, text, at });

describe("memory ranking", () => {
  it("puts the best match first and matches other word forms, in Hebrew too", () => {
    const docs = [
      doc("a", "Deploy checklist", "How we deploy to Railway: run migrations first."),
      doc("b", "Lunch", "Pizza on Fridays."),
      doc("c", "Old deployment notes", "Deployments used to go through Heroku."),
      doc("d", "סגנון קוד", "והקוד תמיד עם בדיקות"),
    ];
    const hits = rankDocs(docs, "deploy railway");
    expect(hits.map((h) => h.id)).toEqual(["a", "c"]);
    expect(rankDocs(docs, "קוד בדיקה").map((h) => h.id)).toEqual(["d"]);
    expect(rankDocs(docs, "the and of")).toEqual([]);
  });

  it("prefers the newer of two equal matches", () => {
    const old = Date.now() - 200 * 24 * 60 * 60_000;
    const hits = rankDocs([doc("old", "API keys", "Rotate keys monthly", old), doc("new", "API keys", "Rotate keys monthly")], "rotate keys");
    expect(hits[0].id).toBe("new");
  });
});

describe("context budget", () => {
  it("keeps sections in order, cuts the one that overflows and says what was left out", () => {
    const { text, dropped } = fitSections(
      [
        { name: "task", text: "Task: build it" },
        { name: "history", text: "x ".repeat(2_000), cuttable: true, moreWith: "get_task" },
        { name: "team list", text: "Other agents: many", moreWith: "list_agents" },
      ],
      500,
    );
    expect(text.startsWith("Task: build it")).toBe(true);
    expect(text).toContain("[cut short to fit; more with get_task]");
    expect(dropped).toEqual(["part of history (use get_task)", "team list (use list_agents)"]);
    expect(estimateTokens(text)).toBeLessThan(600);
  });

  it("counts Hebrew as more tokens per character than English", () => {
    expect(estimateTokens("שלום עולם שלום")).toBeGreaterThan(estimateTokens("hello world hi"));
  });
});

describe("shortening old tool outputs", () => {
  it("trims old Claude tool results once over budget and keeps recent turns whole", async () => {
    const { compactClaudeMessages } = await import("../src/lib/runner/providers");
    const big = "log line\n".repeat(2_000);
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: "brief" }];
    for (let i = 0; i < 10; i++) {
      messages.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "run_command", input: {} }] });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: big }] });
    }
    expect(compactClaudeMessages(messages, 1_000_000)).toBe(0);
    const trimmed = compactClaudeMessages(messages, 10_000);
    expect(trimmed).toBeGreaterThan(0);
    const out = (m: Anthropic.Beta.BetaMessageParam) => ((m.content as Anthropic.Beta.BetaToolResultBlockParam[])[0].content as string);
    expect(isTrimmed(out(messages[2]))).toBe(true);
    expect(out(messages[messages.length - 1])).toBe(big);
    expect(messages[0].content).toBe("brief");
  });

  it("does the same for Gemini function responses", async () => {
    const { compactGeminiContents } = await import("../src/lib/runner/providers");
    const big = "x".repeat(20_000);
    const contents: Content[] = [];
    for (let i = 0; i < 8; i++) {
      contents.push({ role: "model", parts: [{ functionCall: { name: "read_file", args: {} } }] });
      contents.push({ role: "user", parts: [{ functionResponse: { name: "read_file", response: { output: big } } }] });
    }
    expect(compactGeminiContents(contents, 5_000)).toBeGreaterThan(0);
    expect(isTrimmed(String(contents[1].parts![0].functionResponse!.response!.output))).toBe(true);
    expect(contents[contents.length - 1].parts![0].functionResponse!.response!.output).toBe(big);
  });
});

describe("an agent's own memory", () => {
  it("is private, replaces by title, and can be forgotten", async () => {
    const { agent: a } = await data.createAgent({ name: "Mem A", provider: "anthropic", model: "x", kind: "hosted" });
    const { agent: b } = await data.createAgent({ name: "Mem B", provider: "anthropic", model: "x", kind: "hosted" });
    const remember = tools.findTool("remember")!;
    await remember.run({ title: "Style", text: "Short answers" }, { agent: a });
    await remember.run({ title: "Style", text: "Short answers in Hebrew" }, { agent: a });
    await remember.run({ title: "Style", text: "Long answers" }, { agent: b });
    const mine = await data.getAgentMemories(a.id);
    expect(mine.map((m) => m.text)).toEqual(["Short answers in Hebrew"]);

    const search = tools.findTool("search_memory")!;
    const res = (await search.run({ query: "answers", sources: ["my_memory"] }, { agent: a })) as { results: { snippet: string }[] };
    expect(res.results.map((r) => r.snippet)).toEqual(["Short answers in Hebrew"]);

    await expect(tools.findTool("forget")!.run({ title: "Nope" }, { agent: a })).rejects.toThrow(/Yours: Style/);
    await tools.findTool("forget")!.run({ title: "Style" }, { agent: a });
    expect(await data.getAgentMemories(a.id)).toEqual([]);
    expect(await data.getAgentMemories(b.id)).toHaveLength(1);
  });

  it("finds results of finished tasks and goes into the next task's brief", async () => {
    const { agent } = await data.createAgent({ name: "Briefed", provider: "anthropic", model: "x", kind: "hosted" });
    const old = await data.createTask({ title: "Build invoice PDF export", ownerAgentId: agent.id });
    await tools.findTool("complete_task")!.run({ taskId: old.id, summary: "Used pdfkit; fonts live in assets/fonts." }, { agent });
    await data.rememberForAgent({ agentId: agent.id, title: "User prefers TypeScript", text: "Write everything in TypeScript." });

    const hits = await (await import("../src/lib/memory")).searchMemory(agent.id, "invoice pdf");
    expect(hits[0]).toMatchObject({ source: "task_result", id: old.id });
    expect(hits[0].snippet).toContain("pdfkit");

    const { brief } = await import("../src/lib/runner/runner");
    const next = await data.createTask({ title: "Add a PDF export for invoices to the admin page" });
    const text = await brief((await data.getAgent(agent.id)) as never, next);
    expect(text).toContain("Your task (id");
    expect(text).toContain("User prefers TypeScript");
    expect(text).toContain("Possibly related");
    expect(text).toContain(old.id);

    // A tight budget keeps the task and says what it left out.
    const tight = await brief((await data.getAgent(agent.id)) as never, next, 60);
    expect(tight).toContain("Your task (id");
    expect(tight).toContain("Left out to keep this short");
  });
});
