/**
 * The context engine: keeps what a hosted agent reads inside a token budget.
 *
 * - The task brief is built from sections in priority order (the task itself
 *   first, team roster last). Sections that don't fit are cut short or left
 *   out, and the brief says which, so the agent can fetch them with its tools.
 * - During a run, once the conversation grows past the limit, old tool outputs
 *   are shortened (see the providers), keeping the most recent turns whole.
 *
 * Token counts are estimates (about 4 characters per token for English, fewer
 * for other scripts), which is all a budget needs.
 */

/** Budget for the first message of a task run. */
export const BRIEF_TOKENS = Number(process.env.CONTEXT_BRIEF_TOKENS ?? 8_000);
/** Once a run's conversation is estimated above this, old tool outputs get shortened. */
export const HISTORY_TOKENS = Number(process.env.CONTEXT_MAX_TOKENS ?? 80_000);
/** The latest messages that are never shortened. */
export const KEEP_RECENT = 6;
/** Old tool outputs are cut to about this many characters. */
const TRIMMED_CHARS = 300;

export function estimateTokens(text: string): number {
  let ascii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
  // Non-Latin scripts (Hebrew, for one) take about one token per two characters.
  return Math.ceil(ascii / 4 + (text.length - ascii) / 2);
}

export type Section = {
  /** Used in the "left out" line, e.g. "team notes". */
  name: string;
  text: string | null | undefined | false | 0;
  /** If it can't fit whole, it's cut to the space left; otherwise it's left out. */
  cuttable?: boolean;
  /** Where the agent finds what was left out, e.g. "read_notes". */
  moreWith?: string;
};

/** Joins sections in order until the budget runs out. */
export function fitSections(sections: Section[], budget: number): { text: string; dropped: string[] } {
  const parts: string[] = [];
  const dropped: string[] = [];
  let left = budget;
  for (const s of sections) {
    if (!s.text) continue;
    const cost = estimateTokens(s.text);
    if (cost <= left) {
      parts.push(s.text);
      left -= cost;
      continue;
    }
    const label = s.moreWith ? `${s.name} (use ${s.moreWith})` : s.name;
    if (s.cuttable && left > 200) {
      parts.push(`${cutToTokens(s.text, left - 30)}\n[cut short to fit; more with ${s.moreWith ?? "your tools"}]`);
      left = 0;
      dropped.push(`part of ${label}`);
    } else {
      dropped.push(label);
    }
  }
  if (dropped.length) parts.push(`Left out to keep this short: ${dropped.join(", ")}.`);
  return { text: parts.join("\n\n"), dropped };
}

export function cutToTokens(text: string, tokens: number): string {
  if (estimateTokens(text) <= tokens) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= tokens) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** What an old tool output becomes once the conversation is too long. */
export function trimmedOutput(output: string): string {
  if (output.length <= TRIMMED_CHARS + 100) return output;
  return `${output.slice(0, TRIMMED_CHARS)}… [older output shortened to save context (${output.length} characters); call the tool again if you need it]`;
}

export function isTrimmed(output: string): boolean {
  return output.includes("[older output shortened to save context");
}
