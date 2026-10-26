"use client";

import { useEffect, useState } from "react";
import { connectTelegramAction, makeVapidKeysAction, saveDigestAction, sendDigestNowAction, testPushAction, testTelegramAction } from "@/app/settings-actions";
import type { DigestSettings } from "@/lib/digest";
import { toast } from "../toast";
import { CopyBox } from "../ui";

export function Card({ title, state, children }: { title: string; state?: { ok: boolean; label: string }; children: React.ReactNode }) {
  return (
    <section className="card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-semibold">{title}</h2>
        {state && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state.ok ? "bg-[#e5f8ef] text-[#037f4c]" : "bg-canvas text-ink-soft"}`}>{state.label}</span>
        )}
      </div>
      {children}
    </section>
  );
}

export function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

export function DigestCard({ initial, email }: { initial: DigestSettings; email: boolean }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Daily digest" state={{ ok: s.enabled, label: s.enabled ? `On at ${s.time}` : "Off" }}>
      <p className="text-sm text-ink-soft">
        Each morning: what got done, what waits on you, what&apos;s in progress and what it cost. Free (no model call). Goes by email{email ? "" : " (not set up yet)"}, Telegram and push, whichever you set up.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        Send the digest
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="d-time">Time</label>
          <input id="d-time" type="time" className="input" value={s.time} onChange={(e) => setS({ ...s, time: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="d-tz">Time zone</label>
          <input id="d-tz" className="input" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await sendDigestNowAction();
            setBusy(false);
            toast("Digest sent");
          }}
        >
          Send one now
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={async () => {
            const r = await saveDigestAction(s);
            toast(r.error ?? "Saved", r.error ? "error" : undefined);
          }}
        >
          Save
        </button>
      </div>
    </Card>
  );
}

export function TelegramCard({ tokenSet, chatSet, ready, publicUrl }: { tokenSet: boolean; chatSet: boolean; ready: boolean; publicUrl: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Telegram" state={{ ok: ready, label: ready ? "Set up" : "Not set up" }}>
      <p className="text-sm text-ink-soft">
        Alerts on your phone, approvals with one tap, and a line to your chief of staff: write (or send a voice message) to the bot and it goes to HQ. Free.
      </p>
      <Steps
        items={[
          <>In Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, and copy the token it gives you.</>,
          <>On Railway, set <code>TELEGRAM_BOT_TOKEN</code> to it{tokenSet ? " ✓" : ""}. The service restarts.</>,
          <>Press <b>Connect</b> below, then send <code>/start</code> to your bot. It answers with your chat id.</>,
          <>Set <code>TELEGRAM_CHAT_ID</code> to that number{chatSet ? " ✓" : ""}, and press <b>Send a test</b>.</>,
        ]}
      />
      {!publicUrl && <p className="text-xs text-[#d83a52]">Set PUBLIC_URL on the server first, so Telegram knows where to send messages.</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          disabled={!tokenSet || busy}
          onClick={async () => {
            setBusy(true);
            const r = await connectTelegramAction();
            setBusy(false);
            toast(r.error ?? "Connected. Now send /start to your bot.", r.error ? "error" : undefined);
          }}
        >
          Connect
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!ready}
          onClick={async () => {
            const r = await testTelegramAction();
            toast(r.error ?? "Sent. Check Telegram.", r.error ? "error" : undefined);
          }}
        >
          Send a test
        </button>
      </div>
    </Card>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushCard({ configured, publicKey }: { configured: boolean; publicKey: string | null }) {
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const [state, setState] = useState<"unknown" | "unsupported" | "on" | "off" | "denied">("unknown");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    void navigator.serviceWorker.getRegistration("/").then(async (reg) => setState((await reg?.pushManager.getSubscription()) ? "on" : "off"));
  }, []);

  async function enable() {
    if (!publicKey) return;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const res = await fetch("/api/ui/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error("save failed");
      setState("on");
      toast("Notifications are on for this device");
    } catch {
      toast("Couldn't turn notifications on here.", "error");
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/ui/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  }

  return (
    <Card title="Push notifications" state={{ ok: configured && state === "on", label: !configured ? "Not set up" : state === "on" ? "On for this device" : "Off for this device" }}>
      <p className="text-sm text-ink-soft">
        Notifications from the app itself, on this phone or computer. On iPhone, add AgentsHUB to the home screen first (Share → Add to Home Screen) and open it from there. Free.
      </p>
      {!configured ? (
        <>
          <Steps
            items={[
              <>Make a key pair (once):</>,
              <>On Railway, set <code>VAPID_PUBLIC_KEY</code> and <code>VAPID_PRIVATE_KEY</code> to the two values. The service restarts.</>,
              <>Come back here on each device and press <b>Turn on for this device</b>.</>,
            ]}
          />
          {keys ? (
            <div className="flex flex-col gap-2">
              <CopyBox label="VAPID_PUBLIC_KEY" text={keys.publicKey} />
              <CopyBox label="VAPID_PRIVATE_KEY" text={keys.privateKey} />
            </div>
          ) : (
            <button type="button" className="btn-ghost self-start" onClick={async () => setKeys(await makeVapidKeysAction())}>
              Make a key pair
            </button>
          )}
        </>
      ) : state === "unsupported" ? (
        <p className="text-sm text-ink-soft">This browser can&apos;t receive push notifications. On iPhone, open AgentsHUB from the home screen.</p>
      ) : state === "denied" ? (
        <p className="text-sm text-ink-soft">Notifications are blocked for this site. Allow them in the browser&apos;s site settings, then reload.</p>
      ) : (
        <div className="flex justify-end gap-2">
          {state === "on" && (
            <>
              <button type="button" className="btn-ghost" onClick={() => void disable()}>Turn off</button>
              <button type="button" className="btn-primary" onClick={async () => { await testPushAction(); toast("Sent"); }}>Send a test</button>
            </>
          )}
          {state !== "on" && <button type="button" className="btn-primary" onClick={() => void enable()}>Turn on for this device</button>}
        </div>
      )}
    </Card>
  );
}
