import { sameText } from "@/middleware";
import { handleUpdate, webhookSecret, type TelegramUpdate } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Telegram calls this for every message to the bot. It's outside the dashboard
 * password; Telegram proves itself with the secret token set by connectWebhook.
 */
export async function POST(req: Request) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return new Response("Telegram isn't set up", { status: 404 });
  if (!sameText(req.headers.get("x-telegram-bot-api-secret-token") ?? "", webhookSecret())) return new Response("Forbidden", { status: 403 });
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    await handleUpdate(update);
  } catch (e) {
    // Answer 200 anyway, or Telegram keeps resending the same update.
    console.error("[telegram] update failed", e);
  }
  return Response.json({ ok: true });
}
