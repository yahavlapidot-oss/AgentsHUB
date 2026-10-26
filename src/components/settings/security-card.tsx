"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { backupNowAction, checkTotpSetupAction, newTotpSetupAction } from "@/app/settings-actions";
import { toast } from "../toast";
import { CopyBox } from "../ui";
import { Card, Steps } from "./notification-cards";

export function TwoStepCard({ on }: { on: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string; svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [checked, setChecked] = useState(false);
  return (
    <Card title="Two-step sign-in" state={{ ok: on, label: on ? "On" : "Off" }}>
      <p className="text-sm text-ink-soft">
        {on
          ? "The dashboard asks for a code from your authenticator app once every 30 days on each browser, on top of the password. To turn it off, remove TOTP_SECRET on the server."
          : "Ask for a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy) on top of the password, so a leaked password isn't enough. Free."}
      </p>
      {!setup ? (
        <div className="flex justify-end">
          <button type="button" className="btn-ghost border border-line" onClick={async () => setSetup(await newTotpSetupAction())}>
            {on ? "Set up a new secret" : "Set it up"}
          </button>
        </div>
      ) : (
        <Steps
          items={[
            <>
              Scan this with your authenticator app (on a phone, you can also tap{" "}
              <a className="text-brand underline" href={setup.uri}>
                this link
              </a>
              ):
              {/* The QR code is SVG made on the server from the otpauth link. */}
              <div className="mt-2 w-40 rounded bg-white p-2 ring-1 ring-line" dangerouslySetInnerHTML={{ __html: setup.svg }} />
            </>,
            <>
              Type the code it shows to check it works:
              <form
                className="mt-1 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await checkTotpSetupAction(setup.secret, code);
                  setChecked(ok);
                  toast(ok ? "The code works" : "That code didn't match", ok ? undefined : "error");
                }}
              >
                <input className="input w-32 font-mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                <button type="submit" className="btn-ghost border border-line" disabled={code.length !== 6}>
                  Check
                </button>
              </form>
            </>,
            <>
              {checked ? "Now set" : "Then set"} this as <code>TOTP_SECRET</code> in Railway (service → Variables) and let it redeploy. Keep a copy somewhere safe: without the app, you&apos;d remove the variable to get back in.
              <CopyBox text={setup.secret} />
            </>,
          ]}
        />
      )}
    </Card>
  );
}

export function BackupsCard({ backups, available }: { backups: { name: string; bytes: number }[]; available: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <Card title="Backups" state={{ ok: available && backups.length > 0, label: !available ? "Not available" : backups.length ? `${backups.length} kept` : "None yet" }}>
      <p className="text-sm text-ink-soft">
        {available
          ? "A copy of the whole database every day, the last 7 kept on the same disk. That covers mistakes and bad data. To also survive losing the disk, download one now and then, or turn on backups for the volume in Railway (billed by storage, usually cents a month)."
          : "The database isn't a local file, so its provider keeps the backups."}
      </p>
      {backups.length > 0 && (
        <ul className="text-sm">
          {backups.map((b) => (
            <li key={b.name} className="flex items-center justify-between border-b border-line py-1 last:border-b-0">
              <a className="text-brand hover:underline" href={`/api/ui/backups/${b.name}`}>
                {b.name}
              </a>
              <span className="text-xs text-ink-faint">{(b.bytes / 1024 / 1024).toFixed(1)} MB</span>
            </li>
          ))}
        </ul>
      )}
      {available && (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-ghost border border-line"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await backupNowAction();
              setBusy(false);
              toast(r.error ?? `Saved ${r.name}`, r.error ? "error" : undefined);
              router.refresh();
            }}
          >
            {busy ? "Saving…" : "Back up now"}
          </button>
        </div>
      )}
    </Card>
  );
}
