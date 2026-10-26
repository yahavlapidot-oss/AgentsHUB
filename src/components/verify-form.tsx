"use client";

import { useState } from "react";

export function VerifyForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card flex w-full max-w-sm flex-col gap-3 p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const res = await fetch("/api/2fa/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        if (res.ok) window.location.assign(next);
        else {
          setErr(body.error ?? "That didn't work");
          setCode("");
        }
      }}
    >
      <h1 className="text-lg font-semibold">Two-step sign-in</h1>
      <p className="text-sm text-ink-soft">Enter the 6-digit code from your authenticator app.</p>
      <label className="sr-only" htmlFor="totp-code">Code</label>
      <input
        id="totp-code"
        className="input text-center font-mono text-2xl tracking-[0.4em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
      />
      {err && <p className="text-sm text-[#d83a52]">{err}</p>}
      <button type="submit" className="btn-primary justify-center" disabled={busy || code.length !== 6}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
