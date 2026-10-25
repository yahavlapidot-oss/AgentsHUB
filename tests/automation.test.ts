import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/lib/policy";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-auto-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let control: typeof import("../src/lib/control");
let tools: typeof import("../src/lib/agent-tools");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  control = await import("../src/lib/control");
  tools = await import("../src/lib/agent-tools");
});

const newAgent = async (name: string) => (await data.createAgent({ name, provider: "anthropic", model: "x", kind: "hosted" })).agent;

async function age(approvalId: string, field: "createdAt" | "decidedAt", msAgo: number) {
  const { db } = await import("../src/lib/db");
  const { approvals } = await import("../src/lib/schema");
  const { eq } = await import("drizzle-orm");
  await db.update(approvals).set({ [field]: Date.now() - msAgo }).where(eq(approvals.id, approvalId));
}

describe("approvals", () => {
  it("names the service an action touches", () => {
    expect(evaluatePolicy("git push origin main").services).toEqual(["Git"]);
    expect(evaluatePolicy("charge the card with stripe").services).toEqual(["Payments"]);
  });

  it("shows where the action happens and what goes out", async () => {
    const agent = await newAgent("Mailer");
    const res = (await tools.findTool("request_approval")!.run(
      { action: "Send the weekly report email to the team", service: "Gmail", details: "To: team@example.com\nSubject: Weekly report" },
      { agent },
    )) as { decision: string; approvalId: string };
    expect(res.decision).toBe("ask");
    const [a] = (await data.getApprovals()).filter((x) => x.id === res.approvalId);
    expect(a).toMatchObject({ service: "Gmail", details: "To: team@example.com\nSubject: Weekly report", decision: "pending" });
  });

  it("expires a request nobody decided on, and the agent takes it as a no", async () => {
    const agent = await newAgent("Waiter");
    const first = await control.gateAction(agent.id, { action: "git push origin main" });
    expect(first.decision).toBe("ask");
    await age(first.decision === "ask" ? first.approval.id : "", "createdAt", (data.APPROVAL_PENDING_HOURS + 1) * 3_600_000);
    const again = await control.gateAction(agent.id, { action: "git push origin main" });
    expect(again.decision).toBe("deny");
    expect(again.reasons[0]).toContain("expired");
    // Asking again after that opens a fresh request.
    expect((await control.gateAction(agent.id, { action: "git push origin main" })).decision).toBe("ask");
  });

  it("makes the agent ask again when an approval sat unused too long", async () => {
    const agent = await newAgent("Slow");
    const asked = await control.gateAction(agent.id, { action: "npm publish" });
    const id = asked.decision === "ask" ? asked.approval.id : "";
    await data.decideApproval(id, "approved");
    await age(id, "decidedAt", (data.APPROVAL_VALID_MINUTES + 5) * 60_000);
    const later = await control.gateAction(agent.id, { action: "npm publish" });
    expect(later.decision).toBe("ask");
    expect(later.decision === "ask" && later.approval.id).not.toBe(id);
    expect((await data.getApprovals()).find((a) => a.id === id)?.decision).toBe("expired");
  });

  it("asks a cautious agent before every sandbox command", async () => {
    const agent = await newAgent("Careful");
    expect((await control.gateAction(agent.id, { action: "Sandbox: npm test", askIfCautious: true })).decision).toBe("allow");
    await data.setAgentAutonomy(agent.id, "cautious");
    const gate = await control.gateAction(agent.id, { action: "Sandbox: npm test", askIfCautious: true });
    expect(gate.decision).toBe("ask");
    expect(gate.decision === "ask" && gate.approval.reason).toContain("ask before every command");
    // Actions that don't opt in are unaffected.
    expect((await control.gateAction(agent.id, { action: "read a file" })).decision).toBe("allow");
  });
});

describe("emergency stop", () => {
  it("stops every agent, refuses every action, and resumes only the agents it stopped", async () => {
    const busy = await newAgent("Busy");
    const pausedByYou = await newAgent("Paused by you");
    await data.sendCommand(pausedByYou.id, "pause");

    const state = await data.emergencyStop();
    expect(state.agentIds).toContain(busy.id);
    expect(state.agentIds).not.toContain(pausedByYou.id);
    expect((await data.getAgent(busy.id))?.status).toBe("paused");
    expect((await data.getCommands(busy.id)).some((c) => c.type === "stop" && c.status === "pending")).toBe(true);
    expect((await control.gateAction(busy.id, { action: "ls" })).decision).toBe("paused");
    expect((await data.getSnapshot()).emergencyStop?.at).toBe(state.at);

    await data.resumeAfterEmergencyStop();
    expect(await data.getEmergencyStop()).toBeNull();
    expect((await data.getAgent(busy.id))?.status).not.toBe("paused");
    expect((await data.getAgent(pausedByYou.id))?.status).toBe("paused");
    // The stop that was never picked up won't end the agent's next task.
    expect((await data.getCommands(busy.id)).some((c) => c.type === "stop" && c.status === "pending")).toBe(false);
    expect((await control.gateAction(busy.id, { action: "ls" })).decision).toBe("allow");
  });
});

describe("audit log", () => {
  it("lists approvals asked, decided and used, and your commands", async () => {
    const agent = await newAgent("Audited");
    const asked = await control.gateAction(agent.id, { action: "railway up" });
    const id = asked.decision === "ask" ? asked.approval.id : "";
    await data.decideApproval(id, "approved");
    expect((await control.gateAction(agent.id, { action: "railway up" })).decision).toBe("allow");
    await data.sendCommand(agent.id, "redirect", "Focus on tests");

    const log = await data.getAuditLog({ agentId: agent.id });
    const lines = log.map((e) => `${e.actor} ${e.text}`);
    expect(lines).toContain("Audited asked to: railway up (Deploy)");
    expect(lines).toContain("You approved Audited's request: railway up");
    expect(lines).toContain("Audited used the approval: railway up");
    expect(lines).toContain("You sent redirect to Audited: Focus on tests");
    expect(log.every((e, i) => i === 0 || log[i - 1].at >= e.at)).toBe(true);
  });
});
