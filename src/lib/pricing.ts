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

/**
 * Prompt caching: tokens read from the cache cost a fraction of the input
 * price, and Claude charges a bit extra (1.25x) to write them the first time.
 * Read prices: Claude 0.1x (Opus 5.5 0.05x, Fable 5.1 0.025x), GPT 0.1x, Gemini 0.25x.
 */
export type CacheUsage = { cacheRead?: number; cacheWrite?: number };

export function cacheMultipliers(model: string): { read: number; write: number } {
  if (model.startsWith("claude-fable-5-1")) return { read: 0.025, write: 1.25 };
  if (model.startsWith("claude-opus-5-5")) return { read: 0.05, write: 1.25 };
  if (model.startsWith("claude-")) return { read: 0.1, write: 1.25 };
  if (model.startsWith("gemini-")) return { read: 0.25, write: 1 };
  return { read: 0.1, write: 1 };
}

/** The cost of a call where some of tokensIn came from (or went into) the prompt cache. */
export function cachedCostUsd(model: string, tokensIn: number, tokensOut: number, cache: CacheUsage = {}): number {
  const p = priceFor(model);
  if (!p) return 0;
  const m = cacheMultipliers(model);
  const read = Math.min(cache.cacheRead ?? 0, tokensIn);
  const write = Math.min(cache.cacheWrite ?? 0, tokensIn - read);
  const plain = tokensIn - read - write;
  return ((plain + read * m.read + write * m.write) * p[0] + tokensOut * p[1]) / 1_000_000;
}

/** A turn's cost, and what it saved against the full uncached price on the agent's main model. */
export function turnCost(input: { model: string; mainModel: string; tokensIn: number; tokensOut: number } & CacheUsage): { costUsd: number; savedUsd: number } {
  const cost = cachedCostUsd(input.model, input.tokensIn, input.tokensOut, input);
  const full = costUsd(input.mainModel, input.tokensIn, input.tokensOut) || costUsd(input.model, input.tokensIn, input.tokensOut);
  return { costUsd: cost, savedUsd: Math.max(0, full - cost) };
}
