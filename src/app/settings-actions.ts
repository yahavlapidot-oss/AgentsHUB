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

/** A new authenticator secret to scan. Nothing is saved: you put it in TOTP_SECRET on the server. */
export async function newTotpSetupAction(): Promise<{ secret: string; uri: string; svg: string }> {
  const { newTotpSecret, otpauthUri } = await import("@/lib/totp");
  const { renderSVG } = await import("uqr");
  const secret = newTotpSecret();
  const uri = otpauthUri(secret, "dashboard");
  return { secret, uri, svg: renderSVG(uri) };
}

export async function checkTotpSetupAction(secret: string, code: string): Promise<boolean> {
  const { verifyTotp } = await import("@/lib/totp");
  try {
    return verifyTotp(secret, code) !== null;
  } catch {
    return false;
  }
}

export async function backupNowAction(): Promise<{ name?: string; error?: string }> {
  const { runBackup } = await import("@/lib/backups");
  try {
    return { name: (await runBackup()).name };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
