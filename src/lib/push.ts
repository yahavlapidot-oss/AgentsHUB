/**
 * Push notifications to the installed app (phone home screen or desktop), with
 * the Web Push standard. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (Settings
 * can make a pair), then turn notifications on in Settings on each device.
 * Subscriptions live in settings; ones the browser dropped are removed.
 */
import webpush from "web-push";
import { getSetting, setSetting } from "./data";
import { boardLink, type NotifyOptions } from "./notify";

const KEY = "push_subscriptions";
export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export function makeVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}

export async function getSubscriptions(): Promise<PushSubscriptionJson[]> {
  return (await getSetting<PushSubscriptionJson[]>(KEY)) ?? [];
}

export async function addSubscription(sub: PushSubscriptionJson): Promise<void> {
  const all = (await getSubscriptions()).filter((s) => s.endpoint !== sub.endpoint);
  await setSetting(KEY, [...all.slice(-19), sub]);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await setSetting(KEY, (await getSubscriptions()).filter((s) => s.endpoint !== endpoint));
}

const PATHS: Partial<Record<NonNullable<NotifyOptions["kind"]>, string>> = { approval: "/approvals", stuck: "/", finished: "/", digest: "/", budget: "/usage", server: "/status", reply: "/chat/hq" };

export async function pushAlert(title: string, text: string, opts: NotifyOptions): Promise<void> {
  if (!pushConfigured()) return;
  const subs = await getSubscriptions();
  if (!subs.length) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${process.env.NOTIFY_EMAIL || "admin@example.com"}`, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const payload = JSON.stringify({
    title,
    body: text.replace(/https?:\/\/\S+/g, "").slice(0, 300).trim(),
    url: opts.url ?? boardLink(PATHS[opts.kind ?? "finished"] ?? "/"),
    tag: opts.approvalId ?? opts.kind,
  });
  await Promise.all(
    subs.map((s) =>
      webpush.sendNotification(s, payload, { TTL: 24 * 60 * 60 }).catch(async (e: { statusCode?: number }) => {
        // The browser threw the subscription away (app removed, permission revoked).
        if (e.statusCode === 404 || e.statusCode === 410) await removeSubscription(s.endpoint);
        else console.error("[push] send failed", e);
      }),
    ),
  );
}
