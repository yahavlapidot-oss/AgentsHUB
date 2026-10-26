import { DigestCard, PushCard, TelegramCard } from "@/components/settings/notification-cards";
import { PageHeader } from "@/components/ui";
import { getDigestSettings } from "@/lib/digest";
import { pushConfigured, vapidPublicKey } from "@/lib/push";
import { telegramConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const digest = await getDigestSettings();
  return (
    <div>
      <PageHeader title="Settings" subtitle="How AgentsHUB reaches you, and the switches that apply to the whole team." />
      <div className="grid max-w-5xl gap-4 p-4 sm:p-6 lg:grid-cols-2">
        <DigestCard initial={digest} email={Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL)} />
        <TelegramCard tokenSet={Boolean(process.env.TELEGRAM_BOT_TOKEN)} chatSet={Boolean(process.env.TELEGRAM_CHAT_ID)} ready={telegramConfigured()} publicUrl={process.env.PUBLIC_URL ?? null} />
        <PushCard configured={pushConfigured()} publicKey={vapidPublicKey()} />
      </div>
    </div>
  );
}
