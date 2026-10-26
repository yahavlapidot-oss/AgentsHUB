/**
 * Alerts for things that need you, sent everywhere you've set up: email
 * (Resend), Telegram, and push notifications to the installed app. Each channel
 * is off until its keys are set, and a failing channel never breaks the caller.
 */
export type NotifyKind = "approval" | "stuck" | "finished" | "error" | "budget" | "digest" | "server" | "reply";
export type NotifyOptions = { kind?: NotifyKind; approvalId?: string; url?: string };

export async function notify(subject: string, text: string, opts: NotifyOptions = {}): Promise<void> {
  const short = subject.replace(/^\[AgentsHUB\]\s*/, "");
  await Promise.all([
    notifyByEmail(subject, text),
    import("./telegram").then((t) => t.telegramAlert(short, text, opts)).catch((e) => console.error("Telegram alert failed", e)),
    import("./push").then((p) => p.pushAlert(short, text, opts)).catch((e) => console.error("Push alert failed", e)),
  ]);
}

/** Email only, through Resend's HTTP API. Off unless RESEND_API_KEY and NOTIFY_EMAIL are set. */
export async function notifyByEmail(subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!key || !to) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM ?? "AgentsHUB <onboarding@resend.dev>",
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) console.error(`Email alert failed: ${res.status} ${await res.text()}`);
  } catch (e) {
    // An alert must never break the agent's request.
    console.error("Email alert failed", e);
  }
}

export function boardLink(path: string): string {
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}
