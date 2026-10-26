"use client";

import { useState } from "react";
import { saveQualityAction } from "@/app/actions";
import type { QualitySettings } from "@/lib/quality";
import { toast } from "../toast";
import { Card } from "./notification-cards";

export function QualityCard({ initial, agents }: { initial: QualitySettings; agents: { id: string; name: string }[] }) {
  const [s, setS] = useState(initial);
  const on = s.mode !== "off" && Boolean(s.reviewerAgentId);
  return (
    <Card title="Quality check" state={{ ok: on, label: on ? (s.mode === "all" ? "Every task" : "Important tasks") : "Off" }}>
      <p className="text-sm text-ink-soft">
        A reviewer agent checks finished work against its acceptance criteria before it reaches you, and sends it back with notes when it falls short. Each review is one more model run, so it adds to the cost; a cheaper model is fine for reviewing.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="q-reviewer">Reviewer</label>
          <select id="q-reviewer" className="input" value={s.reviewerAgentId ?? ""} onChange={(e) => setS({ ...s, reviewerAgentId: e.target.value || null })}>
            <option value="">Nobody</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="q-mode">Review</label>
          <select id="q-mode" className="input" value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as QualitySettings["mode"] })}>
            <option value="off">Nothing</option>
            <option value="important">High and critical tasks</option>
            <option value="all">Every task</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="q-rounds">Rounds at most</label>
          <input id="q-rounds" type="number" min={1} max={5} className="input" value={s.maxRounds} onChange={(e) => setS({ ...s, maxRounds: Number(e.target.value) || 1 })} />
        </div>
      </div>
      <p className="text-xs text-ink-faint">Your own 👍/👎 on a finished task is saved to that agent&apos;s memory, so it learns what you like.</p>
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={async () => {
            try {
              await saveQualityAction(s);
              toast("Saved");
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        >
          Save
        </button>
      </div>
    </Card>
  );
}
