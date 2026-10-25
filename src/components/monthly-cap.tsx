"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setMonthlyCapAction } from "@/app/actions";

/** Edit the hub-wide monthly cap. Empty means no cap. */
export function MonthlyCapForm({ cap }: { cap: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(cap != null ? String(cap) : "");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const usd = value.trim() ? Number(value) : null;
    if (usd != null && !(usd > 0)) return setErr("Enter a positive amount, or leave it empty for no cap.");
    setSaving(true);
    try {
      await setMonthlyCapAction(usd);
      setErr(null);
      router.refresh();
    } catch {
      setErr("Could not save the cap.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={save}>
      <div>
        <label className="label" htmlFor="monthly-cap">Monthly cap (USD)</label>
        <input id="monthly-cap" className="input w-36" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="No cap" />
      </div>
      <button type="submit" className="btn-primary" disabled={saving}>Save</button>
      {err && <p className="w-full text-sm text-[#d83a52]">{err}</p>}
    </form>
  );
}
