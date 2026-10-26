"use server";

import { buildDigest, setDigestSettings, type DigestSettings } from "@/lib/digest";
import { notify } from "@/lib/notify";
import { makeVapidKeys, pushAlert } from "@/lib/push";
import { connectWebhook, sendTelegram, telegramConfigured } from "@/lib/telegram";

// Server actions for the Settings page.

export async function saveDigestAction(s: DigestSettings): Promise<{ error?: string }> {
  try {
    await setDigestSettings(s);
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function sendDigestNowAction(): Promise<void> {
  const d = await buildDigest();
  await notify(d.subject, d.text, { kind: "digest" });
}

export async function connectTelegramAction(): Promise<{ url?: string; error?: string }> {
  try {
    const url = await connectWebhook();
    if (telegramConfigured()) await sendTelegram("AgentsHUB is connected. Write here to talk to your chief of staff. /help shows the commands.");
    return { url };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function testTelegramAction(): Promise<{ error?: string }> {
  try {
    if (!telegramConfigured()) return { error: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first" };
    await sendTelegram("Test from AgentsHUB: alerts reach you here.");
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function makeVapidKeysAction() {
  return makeVapidKeys();
}

export async function testPushAction(): Promise<void> {
  await pushAlert("Test from AgentsHUB", "Notifications reach this device.", { kind: "digest" });
}
