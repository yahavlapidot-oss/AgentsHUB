import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-notify-")), "test.db")}`;

let data: typeof import("../src/lib/data");
let digest: typeof import("../src/lib/digest");
let telegram: typeof import("../src/lib/telegram");
let push: typeof import("../src/lib/push");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
  digest = await import("../src/lib/digest");
  telegram = await import("../src/lib/telegram");
  push = await import("../src/lib/push");
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

describe("daily digest", () => {
  const s = { enabled: true, time: "08:00", timezone: "Asia/Jerusalem" };
  it("is due once after the day's time has passed", () => {
    const before = Date.UTC(2026, 9, 26, 5, 59); // 07:59 in Jerusalem
    const after = Date.UTC(2026, 9, 26, 6, 1);
    expect(digest.digestDue(s, Date.UTC(2026, 9, 25, 6, 0), before)).toBe(false);
    expect(digest.digestDue(s, Date.UTC(2026, 9, 25, 6, 0), after)).toBe(true);
    expect(digest.digestDue(s, after, after + 60_000)).toBe(false);
    expect(digest.digestDue({ ...s, enabled: false }, null, after)).toBe(false);
  });

  it("lists what needs you and what got done", async () => {
    const { agent } = await data.createAgent({ name: "Writer", provider: "anthropic", model: "x", kind: "hosted" });
    const done = await data.createTask({ title: "Blog post", ownerAgentId: agent.id });
    await data.updateTask(done.id, { column: "review" });
    await data.createTask({ title: "Pick a domain", column: "waiting_on_you" });
    await data.requestApproval(agent.id, { action: "Send the newsletter" });
    const d = await digest.buildDigest();
    expect(d.needsYou).toBe(3);
    expect(d.text).toContain("Writer: Send the newsletter");
    expect(d.text).toContain("Pick a domain");
    expect(d.text).toContain("Blog post (Writer)");
    expect(d.subject).toMatch(/1 done, 3 need you/);
  });
});

describe("telegram", () => {
  function fakeTelegram() {
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ method: url.split("/").pop()!, body: JSON.parse(String(init.body)) });
        return Response.json({ ok: true, result: {} });
      }),
    );
    return calls;
  }

  it("tells a stranger their chat id and ignores everything else from them", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "t";
    process.env.TELEGRAM_CHAT_ID = "42";
    const calls = fakeTelegram();
    expect(await telegram.handleUpdate({ message: { chat: { id: 7 }, text: "/start" } })).toBe("start");
    expect(String(calls[0].body.text)).toContain("Your chat id is 7");
    expect(await telegram.handleUpdate({ message: { chat: { id: 7 }, text: "/stop" } })).toBe("ignored: not your chat");
    expect(await data.getEmergencyStop()).toBeNull();
  });

  it("approves with a button and forwards text to the chief of staff", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "t";
    process.env.TELEGRAM_CHAT_ID = "42";
    const calls = fakeTelegram();
    const { agent } = await data.createAgent({ name: "Ops", provider: "anthropic", model: "x", kind: "hosted" });
    const approval = await data.requestApproval(agent.id, { action: "Deploy to production" });
    expect(String(calls.at(-1)!.body.text)).toContain("needs your approval");
    expect(JSON.stringify(calls.at(-1)!.body.reply_markup)).toContain(`ap:${approval.id}:y`);

    const r = await telegram.handleUpdate({ callback_query: { id: "c1", data: `ap:${approval.id}:y`, message: { chat: { id: 42 }, message_id: 5 } } });
    expect(r).toContain("Approved");
    expect((await data.getApproval(approval.id))?.decision).toBe("approved");

    expect(await telegram.handleUpdate({ message: { chat: { id: 42 }, text: "תזמין לי פגישה" } })).toBe("no chief");
    await data.setChiefAgentId(agent.id);
    expect(await telegram.handleUpdate({ message: { chat: { id: 42 }, text: "תזמין לי פגישה" } })).toBe("sent to chief");
    const [m] = (await data.getMessages({ projectId: "hq" })).slice(-1);
    expect(m).toMatchObject({ text: "תזמין לי פגישה", toAgentId: agent.id, fromAgentId: null });

    // The chief's answer in HQ goes back to Telegram.
    const before = calls.length;
    await data.postMessage({ fromAgentId: agent.id, projectId: "hq", text: "קבעתי לך ליום שלישי" });
    await vi.waitFor(() => expect(calls.slice(before).some((c) => c.body.text === "קבעתי לך ליום שלישי")).toBe(true));
  });
});

describe("push subscriptions", () => {
  it("keeps one entry per device", async () => {
    const sub = { endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" } };
    await push.addSubscription(sub);
    await push.addSubscription(sub);
    expect(await push.getSubscriptions()).toHaveLength(1);
    await push.removeSubscription(sub.endpoint);
    expect(await push.getSubscriptions()).toHaveLength(0);
    expect(push.makeVapidKeys().publicKey.length).toBeGreaterThan(40);
  });
});
