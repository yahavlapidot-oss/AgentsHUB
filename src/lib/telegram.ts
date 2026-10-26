/**
 * Telegram: alerts on your phone, approvals with one tap, and a line to your
 * chief of staff. Set TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID
 * (send /start to the bot to see yours), then "Connect" on the Settings page,
 * which points the bot's webhook at /api/telegram/webhook.
 *
 * Only your own chat is listened to; everything else is ignored.
 */
import { createHash } from "node:crypto";
import { HQ_CHANNEL } from "./hq";
import type { Message } from "./schema";
import type { NotifyOptions } from "./notify";

const API = "https://api.telegram.org";
const MAX_TEXT = 4000;

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** The secret Telegram sends back with every webhook call. */
export function webhookSecret(): string {
  return process.env.TELEGRAM_WEBHOOK_SECRET || createHash("sha256").update(`agentshub:${process.env.TELEGRAM_BOT_TOKEN ?? ""}`).digest("hex").slice(0, 48);
}

type Button = { text: string; callback_data: string };

export async function telegramCall<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN isn't set");
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

export async function sendTelegram(text: string, opts: { buttons?: Button[][]; chatId?: string | number } = {}): Promise<void> {
  const chatId = opts.chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;
  await telegramCall("sendMessage", {
    chat_id: chatId,
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
    disable_web_page_preview: true,
    ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
  });
}

export function approvalButtons(approvalId: string): Button[][] {
  return [[{ text: "✅ Approve", callback_data: `ap:${approvalId}:y` }, { text: "❌ Deny", callback_data: `ap:${approvalId}:n` }]];
}

/** Called by notify(): a short version of the alert, with buttons for approvals. */
export async function telegramAlert(subject: string, text: string, opts: NotifyOptions): Promise<void> {
  if (!telegramConfigured()) return;
  const body = opts.kind === "digest" ? text : text.slice(0, 1_500);
  await sendTelegram(`${subject}\n\n${body}`, { buttons: opts.approvalId ? approvalButtons(opts.approvalId) : undefined });
}

/** The chief of staff's answers in HQ also go to Telegram, so a conversation started there continues there. */
export async function relayHqReply(m: Message): Promise<void> {
  if (!telegramConfigured() || m.projectId !== HQ_CHANNEL || !m.fromAgentId) return;
  const { getChiefAgentId } = await import("./data");
  if ((await getChiefAgentId()) !== m.fromAgentId) return;
  await sendTelegram(m.text);
}

export type TelegramUpdate = {
  message?: { chat: { id: number }; text?: string; voice?: { file_id: string; duration?: number } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number; text?: string } };
};

const HELP = [
  "AgentsHUB on Telegram:",
  "Write anything to send it to your chief of staff.",
  "/status – what needs you and what's going on",
  "/approvals – approvals waiting, with buttons",
  "/stop – emergency stop for every agent",
  "/resume – end the emergency stop",
].join("\n");

/** Handles one webhook update. Returns what was done, for logs and tests. */
export async function handleUpdate(update: TelegramUpdate): Promise<string> {
  const owner = process.env.TELEGRAM_CHAT_ID;
  const data = await import("./data");

  const cb = update.callback_query;
  if (cb) {
    if (!owner || String(cb.message?.chat.id) !== owner) return "ignored: not your chat";
    const m = cb.data?.match(/^ap:([\w-]+):([yn])$/);
    if (!m) return "ignored: unknown button";
    const decided = await data.decideApproval(m[1], m[2] === "y" ? "approved" : "denied");
    const word = !decided ? "Already decided or expired" : m[2] === "y" ? "Approved" : "Denied";
    await telegramCall("answerCallbackQuery", { callback_query_id: cb.id, text: word }).catch(() => {});
    if (cb.message) {
      await telegramCall("editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      await sendTelegram(`${word}.`, { chatId: cb.message.chat.id });
    }
    return `approval ${m[1]}: ${word}`;
  }

  const msg = update.message;
  if (!msg) return "ignored: nothing to do";
  const chatId = msg.chat.id;
  let text = msg.text?.trim() ?? "";
  if (text === "/start" || text === "/id") {
    await sendTelegram(owner === String(chatId) ? HELP : `Your chat id is ${chatId}. Set TELEGRAM_CHAT_ID=${chatId} on the server, then send /start again.`, { chatId });
    return "start";
  }
  if (!owner || String(chatId) !== owner) return "ignored: not your chat";

  if (text === "/help") {
    await sendTelegram(HELP);
    return "help";
  }
  if (text === "/status") {
    const { buildDigest } = await import("./digest");
    await sendTelegram((await buildDigest()).text);
    return "status";
  }
  if (text === "/approvals") {
    const pending = await data.getApprovals({ pendingOnly: true });
    if (!pending.length) await sendTelegram("No approvals waiting.");
    const names = new Map((await data.getAgents()).map((a) => [a.id, a.name]));
    for (const a of pending.slice(0, 10)) {
      await sendTelegram(`${names.get(a.agentId) ?? "An agent"} wants to: ${a.action}${a.service ? `\nWhere: ${a.service}` : ""}${a.details ? `\n\n${a.details.slice(0, 1_000)}` : ""}`, { buttons: approvalButtons(a.id) });
    }
    return `approvals: ${pending.length}`;
  }
  if (text === "/stop") {
    await data.emergencyStop();
    await sendTelegram("Emergency stop is on. Every agent is paused. Send /resume to end it.");
    return "stop";
  }
  if (text === "/resume") {
    const n = await data.resumeAfterEmergencyStop();
    await sendTelegram(`Emergency stop is off. ${n} agent${n === 1 ? "" : "s"} resumed.`);
    return "resume";
  }
  if (!text && msg.voice) {
    const { transcribeTelegramVoice } = await import("./voice");
    text = await transcribeTelegramVoice(msg.voice.file_id).catch((e) => {
      void sendTelegram(`Couldn't understand the voice message: ${(e as Error).message}`);
      return "";
    });
    if (!text) return "voice: not transcribed";
    await sendTelegram(`🎤 ${text}`);
  }
  if (!text || text.startsWith("/")) {
    await sendTelegram(HELP);
    return "help";
  }
  const chiefId = await data.getChiefAgentId();
  if (!chiefId) {
    await sendTelegram("Pick your chief of staff first: AgentsHUB → Chats → HQ.");
    return "no chief";
  }
  await data.postMessage({ fromAgentId: null, toAgentId: chiefId, projectId: HQ_CHANNEL, text });
  return "sent to chief";
}

/** Points the bot at this server. Needs PUBLIC_URL. */
export async function connectWebhook(): Promise<string> {
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (!base?.startsWith("https://")) throw new Error("Set PUBLIC_URL to the board's https address first");
  const url = `${base}/api/telegram/webhook`;
  await telegramCall("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query"] });
  await telegramCall("setMyCommands", {
    commands: [
      { command: "status", description: "What needs you and what's going on" },
      { command: "approvals", description: "Approvals waiting" },
      { command: "stop", description: "Emergency stop" },
      { command: "resume", description: "End the emergency stop" },
    ],
  }).catch(() => {});
  return url;
}
