import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-quality-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let quality: typeof import("../src/lib/quality");
let tools: typeof import("../src/lib/tool-hub");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  quality = await import("../src/lib/quality");
  tools = await import("../src/lib/tool-hub");
});

const run = (name: string, args: unknown, agent: { id: string; name: string }) => tools.ALL_TOOLS.find((t) => t.name === name)!.run(args, { agent });

describe("quality loop", () => {
  it("sends finished work to the reviewer, and back to the owner with notes", async () => {
    const { agent: dev } = await data.createAgent({ name: "Dev", provider: "anthropic", model: "x", kind: "hosted" });
    const { agent: rev } = await data.createAgent({ name: "Rev", provider: "anthropic", model: "x", kind: "hosted" });
    await quality.setQualitySettings({ reviewerAgentId: rev.id, mode: "important", maxRounds: 2 });

    const low = await data.createTask({ title: "Small fix", ownerAgentId: dev.id, priority: "low" });
    expect(await run("complete_task", { taskId: low.id, summary: "Done" }, dev)).not.toHaveProperty("review");

    const task = await data.createTask({ title: "Landing page", ownerAgentId: dev.id, priority: "high", acceptanceCriteria: "Has a signup form" });
    const out = (await run("complete_task", { taskId: task.id, summary: "Built it" }, dev)) as { review?: string };
    expect(out.review).toMatch(/Sent for review/);
    const review = (await data.getTasks()).find((t) => t.createdBy === `review:${task.id}`)!;
    expect(review.ownerAgentId).toBe(rev.id);
    expect(review.column).toBe("ready");
    expect(review.acceptanceCriteria).toBe("Has a signup form");

    await run("review_verdict", { taskId: task.id, verdict: "changes", feedback: "The signup form is missing." }, rev);
    expect((await data.getTask(task.id))!.column).toBe("ready");
    expect((await data.getTask(review.id))!.column).toBe("done");
    const inbox = await data.getInbox(dev.id, 0);
    expect(inbox.some((m) => m.text.includes("signup form is missing"))).toBe(true);
    await expect(run("review_verdict", { taskId: task.id, verdict: "approve", feedback: "Looks fine now." }, rev)).rejects.toThrow(/no open review/);

    // Round two, then approval: the task stays in review for the user.
    await run("complete_task", { taskId: task.id, summary: "Added the form" }, dev);
    await run("review_verdict", { taskId: task.id, verdict: "approve", feedback: "Form works and validates." }, rev);
    expect((await data.getTask(task.id))!.column).toBe("review");

    // No third round: the cap is two.
    await data.updateTask(task.id, { column: "in_progress" });
    expect(await run("complete_task", { taskId: task.id, summary: "Tweak" }, dev)).not.toHaveProperty("review");
  });

  it("saves your rating in the owner's memory", async () => {
    const { agent } = await data.createAgent({ name: "Writer", provider: "anthropic", model: "x", kind: "hosted" });
    const task = await data.createTask({ title: "Newsletter", ownerAgentId: agent.id });
    await quality.rateTask(task.id, -1, "Too long, keep it under 200 words");
    const t = (await data.getTask(task.id))!;
    expect(t.rating).toBe(-1);
    const mem = await data.getAgentMemories(agent.id);
    expect(mem[0].title).toBe("Feedback: Newsletter");
    expect(mem[0].text).toContain("under 200 words");
  });
});
