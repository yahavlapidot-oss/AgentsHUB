import { z } from "zod";
import { addSubscription, removeSubscription } from "@/lib/push";

export const dynamic = "force-dynamic";

const Sub = z.object({ endpoint: z.string().url().max(2_000), keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }) });

/** This device's push subscription, from the Settings page. Behind the dashboard password. */
export async function POST(req: Request) {
  const parsed = Sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid subscription" }, { status: 400 });
  await addSubscription(parsed.data);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (body.endpoint) await removeSubscription(body.endpoint);
  return Response.json({ ok: true });
}
