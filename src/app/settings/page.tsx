import { DigestCard, PushCard, TelegramCard } from "@/components/settings/notification-cards";
import { QualityCard } from "@/components/settings/quality-card";
import { PageHeader } from "@/components/ui";
import { getHostedAgents } from "@/lib/data";
import { getQualitySettings } from "@/lib/quality";
import { getDigestSettings } from "@/lib/digest";
import { pushConfigured, vapidPublicKey } from "@/lib/push";
import { telegramConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [digest, quality, hosted] = await Promise.all([getDigestSettings(), getQualitySettings(), getHostedAgents()]);
  return (
    <div>
      <PageHeader title="Settings" subtitle="How AgentsHUB reaches you, and the switches that apply to the whole team." />
      <div className="grid max-w-5xl gap-4 p-4 sm:p-6 lg:grid-cols-2">
        <DigestCard initial={digest} email={Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL)} />
        <TelegramCard tokenSet={Boolean(process.env.TELEGRAM_BOT_TOKEN)} chatSet={Boolean(process.env.TELEGRAM_CHAT_ID)} ready={telegramConfigured()} publicUrl={process.env.PUBLIC_URL ?? null} />
        <PushCard configured={pushConfigured()} publicKey={vapidPublicKey()} />
        <QualityCard initial={quality} agents={hosted.map((a) => ({ id: a.id, name: a.name }))} />
      </div>
    </div>
  );
}
