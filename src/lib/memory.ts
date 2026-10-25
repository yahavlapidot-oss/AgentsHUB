/**
 * Search over everything the team remembers: the team notes, the agent's own
 * memory, results of finished tasks and the agent's conversations. Used by the
 * search_memory tool and by the context engine to put relevant memory in a
 * task's brief.
 *
 * Ranking is BM25 over words (any script, Hebrew included), with loose matching
 * for word forms and a small boost for recent entries. It runs in memory over a
 * capped number of rows, which is plenty for one team's board, and needs no
 * extra service or API key.
 */
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "./db";
import { getAgentMemories, getNotes } from "./data";
import { events, messages, tasks } from "./schema";

export const MEMORY_SOURCES = ["team_note", "my_memory", "task_result", "message"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export type MemoryDoc = { source: MemorySource; id: string; title: string; text: string; at: number };
export type MemoryHit = { source: MemorySource; id: string; title: string; snippet: string; at: number; score: number };

const MAX_TASKS = 300;
const MAX_MESSAGES = 300;
const SNIPPET_CHARS = 400;
const DAY_MS = 24 * 60 * 60_000;

/** Everything one agent may search: shared memory, its own memory, and its own conversations. */
export async function memoryDocs(agentId: string, sources: readonly MemorySource[] = MEMORY_SOURCES): Promise<MemoryDoc[]> {
  const want = new Set(sources);
  const docs: MemoryDoc[] = [];
  if (want.has("team_note")) {
    for (const n of await getNotes()) docs.push({ source: "team_note", id: n.id, title: n.title, text: n.text, at: n.updatedAt });
  }
  if (want.has("my_memory")) {
    for (const m of await getAgentMemories(agentId)) docs.push({ source: "my_memory", id: m.id, title: m.title, text: m.text, at: m.updatedAt });
  }
  if (want.has("task_result")) docs.push(...(await taskResults()));
  if (want.has("message")) {
    const rows = await db
      .select()
      .from(messages)
      .where(or(eq(messages.fromAgentId, agentId), eq(messages.toAgentId, agentId), isNull(messages.toAgentId)))
      .orderBy(desc(messages.at))
      .limit(MAX_MESSAGES);
    for (const m of rows) {
      const who = m.fromAgentId === agentId ? "you" : m.fromAgentId ?? "user";
      docs.push({ source: "message", id: m.id, title: `Message from ${who}`, text: m.text, at: m.at });
    }
  }
  return docs;
}

/** Finished tasks with the owner's last note (the complete_task summary). */
async function taskResults(): Promise<MemoryDoc[]> {
  const done = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.column, ["review", "done"]))
    .orderBy(desc(tasks.updatedAt))
    .limit(MAX_TASKS);
  if (!done.length) return [];
  const notes = await db
    .select({ taskId: events.taskId, payload: events.payload })
    .from(events)
    .where(and(eq(events.type, "note"), inArray(events.taskId, done.map((t) => t.id))))
    .orderBy(desc(events.at))
    .limit(MAX_TASKS * 10);
  const summary = new Map<string, string>();
  for (const n of notes) {
    const text = (n.payload as { text?: unknown }).text;
    if (n.taskId && !summary.has(n.taskId) && typeof text === "string") summary.set(n.taskId, text);
  }
  return done.map((t) => ({
    source: "task_result" as const,
    id: t.id,
    title: t.title,
    text: [t.description, summary.get(t.id) && `Result: ${summary.get(t.id)}`].filter(Boolean).join("\n"),
    at: t.updatedAt,
  }));
}

export async function searchMemory(
  agentId: string,
  query: string,
  opts: { limit?: number; sources?: readonly MemorySource[]; now?: number } = {},
): Promise<MemoryHit[]> {
  return rankDocs(await memoryDocs(agentId, opts.sources), query, opts);
}

// ---------------------------------------------------------------- ranking

const STOPWORDS = new Set(
  "a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with you your את של על עם זה זו גם או אם כי לא כן יש אין הוא היא הם".split(" "),
);

export function words(text: string): string[] {
  return (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOPWORDS.has(w));
}

/**
 * How well a query word matches a word in the text: 1 for the same word, less for
 * another form of it ("deploy" / "deployment", or Hebrew "קוד" / "והקוד").
 */
function matchWeight(q: string, w: string): number {
  if (q === w) return 1;
  if (q.length < 3) return 0;
  if (w.startsWith(q) && w.length - q.length <= 4) return 0.7;
  if (w.endsWith(q) && w.length - q.length <= 2) return 0.7;
  if (q.startsWith(w) && w.length >= 4 && q.length - w.length <= 2) return 0.6;
  return 0;
}

/** BM25 over title and text (title words count double), times a small recency boost. */
export function rankDocs(docs: MemoryDoc[], query: string, opts: { limit?: number; now?: number } = {}): MemoryHit[] {
  const terms = [...new Set(words(query))];
  if (!terms.length || !docs.length) return [];
  const now = opts.now ?? Date.now();
  const k1 = 1.2;
  const b = 0.75;
  const bags = docs.map((d) => [...words(d.title), ...words(d.title), ...words(d.text)]);
  const avgLen = bags.reduce((n, w) => n + w.length, 0) / bags.length || 1;
  // Per term, per doc: weighted count of matching words.
  const tf = terms.map((t) => bags.map((bag) => bag.reduce((n, w) => n + matchWeight(t, w), 0)));
  const hits: MemoryHit[] = [];
  docs.forEach((d, i) => {
    let score = 0;
    terms.forEach((_, j) => {
      const f = tf[j][i];
      if (!f) return;
      const df = tf[j].filter(Boolean).length;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * bags[i].length) / avgLen));
    });
    if (score <= 0) return;
    const ageDays = Math.max(0, now - d.at) / DAY_MS;
    score *= 1 + 0.25 * Math.exp(-ageDays / 30);
    hits.push({ source: d.source, id: d.id, title: d.title, snippet: snippet(d.text, terms), at: d.at, score: Math.round(score * 1000) / 1000 });
  });
  return hits.sort((x, y) => y.score - x.score || y.at - x.at).slice(0, opts.limit ?? 10);
}

/** The part of the text around the first matching word. */
function snippet(text: string, terms: string[]): string {
  if (text.length <= SNIPPET_CHARS) return text;
  const lower = text.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((x, y) => x - y)[0] ?? 0;
  const start = Math.max(0, at - SNIPPET_CHARS / 4);
  const end = Math.min(text.length, start + SNIPPET_CHARS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
