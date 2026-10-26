import { describe, expect, it } from "vitest";
import { cachedCostUsd, costUsd, turnCost } from "../src/lib/pricing";
import { modelFor } from "../src/lib/runner/runner";

describe("prompt caching prices", () => {
  it("charges cache reads at a fraction and Claude cache writes at 1.25x", () => {
    // claude-sonnet-5-5: $2 in, $10 out per million.
    expect(costUsd("claude-sonnet-5-5", 1_000_000, 0)).toBeCloseTo(2);
    expect(cachedCostUsd("claude-sonnet-5-5", 1_000_000, 0, { cacheRead: 1_000_000 })).toBeCloseTo(0.2);
    expect(cachedCostUsd("claude-sonnet-5-5", 1_000_000, 0, { cacheWrite: 1_000_000 })).toBeCloseTo(2.5);
    expect(cachedCostUsd("claude-opus-5-5", 1_000_000, 0, { cacheRead: 1_000_000 })).toBeCloseTo(0.2); // 0.05 x $4
    // More cached tokens than input can't make it negative.
    expect(cachedCostUsd("claude-sonnet-5-5", 100, 0, { cacheRead: 500 })).toBeGreaterThan(0);
    expect(cachedCostUsd("unknown-model", 1_000, 1_000)).toBe(0);
  });

  it("counts what caching and a cheaper model saved", () => {
    const cached = turnCost({ model: "claude-sonnet-5-5", mainModel: "claude-sonnet-5-5", tokensIn: 1_000_000, tokensOut: 0, cacheRead: 900_000 });
    expect(cached.savedUsd).toBeCloseTo(2 - (0.1 * 2 + 0.9 * 0.2));
    const routed = turnCost({ model: "claude-haiku-5-5", mainModel: "claude-opus-5-5", tokensIn: 1_000_000, tokensOut: 100_000 });
    expect(routed.savedUsd).toBeCloseTo(costUsd("claude-opus-5-5", 1_000_000, 100_000) - costUsd("claude-haiku-5-5", 1_000_000, 100_000));
  });
});

describe("model routing", () => {
  const agent = { model: "claude-opus-5-5", cheapModel: "claude-haiku-5-5" };
  it("sends chats, low-priority tasks and reviews to the cheaper model", () => {
    expect(modelFor(agent, { inbox: true })).toBe("claude-haiku-5-5");
    expect(modelFor(agent, { task: { priority: "low", createdBy: "user" } })).toBe("claude-haiku-5-5");
    expect(modelFor(agent, { task: { priority: "high", createdBy: "review:task_1" } })).toBe("claude-haiku-5-5");
    expect(modelFor(agent, { task: { priority: "medium", createdBy: "user" } })).toBe("claude-opus-5-5");
    expect(modelFor({ ...agent, cheapModel: null }, { inbox: true })).toBe("claude-opus-5-5");
  });
});
