/**
 * Email alerts for things that need you, sent through Resend's HTTP API.
 * Off unless RESEND_API_KEY and NOTIFY_EMAIL are set.
 */
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
