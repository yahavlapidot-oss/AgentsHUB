/**
 * Dollar cost of a model call, for agents AgentsHUB runs itself. Prices are USD
 * per million tokens [input, output]. Claude's list prices are built in; add or
 * override any model with MODEL_PRICES, e.g.
 *   MODEL_PRICES={"gpt-5":[1.25,10],"gemini-2.5-pro":[1.25,10]}
 * A model with no known price is recorded with cost 0 (tokens are still counted).
 */
const BUILT_IN: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
};

function overrides(): Record<string, [number, number]> {
  try {
    return JSON.parse(process.env.MODEL_PRICES || "{}");
  } catch {
    return {};
  }
}

export function priceFor(model: string): [number, number] | null {
  const table = { ...BUILT_IN, ...overrides() };
  if (table[model]) return table[model];
  // Dated or versioned names ("gpt-5-2026-01-01", "gemini-2.5-pro-002") fall back to the longest known prefix.
  const prefix = Object.keys(table)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? table[prefix] : null;
}

export function costUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = priceFor(model);
  return p ? (tokensIn * p[0] + tokensOut * p[1]) / 1_000_000 : 0;
}
