"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteScheduleAction, runScheduleNowAction, saveScheduleAction, setScheduleEnabledAction } from "@/app/schedule-actions";
import { PRIORITY_META, timeAgo } from "@/lib/format";
import { PRIORITIES, SCHEDULE_FREQUENCIES, type Priority, type Schedule, type ScheduleFrequency } from "@/lib/schema";
import { toast } from "./toast";

type Row = Schedule & { when: string };
type Named = { id: string; name: string };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQ_LABELS: Record<ScheduleFrequency, string> = { minutes: "Every N minutes", hourly: "Every hour", daily: "Every day", weekly: "Some days of the week", monthly: "Once a month" };

type Draft = {
  title: string;
  description: string;
  priority: Priority;
  ownerAgentId: string;
  projectId: string;
  frequency: ScheduleFrequency;
  intervalMinutes: number;
  timeOfDay: string;
  weekdays: number[];
  dayOfMonth: number;
  timezone: string;
  skipIfOpen: boolean;
};

function blank(timezone: string): Draft {
  return { title: "", description: "", priority: "medium", ownerAgentId: "", projectId: "", frequency: "daily", intervalMinutes: 60, timeOfDay: "08:00", weekdays: [0], dayOfMonth: 1, timezone, skipIfOpen: true };
}

function fromRow(s: Row): Draft {
  return {
    title: s.title,
    description: s.description,
    priority: s.priority,
    ownerAgentId: s.ownerAgentId ?? "",
    projectId: s.projectId ?? "",
    frequency: s.frequency,
    intervalMinutes: s.intervalMinutes ?? 60,
    timeOfDay: s.timeOfDay,
    weekdays: s.weekdays,
    dayOfMonth: s.dayOfMonth ?? 1,
    timezone: s.timezone,
    skipIfOpen: s.skipIfOpen,
  };
}

function whenNext(ms: number | null): string {
  if (!ms) return "Paused";
  return new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SchedulesView({ schedules, agents, projects, defaultTimezone }: { schedules: Row[]; agents: Named[]; projects: Named[]; defaultTimezone: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blank(defaultTimezone));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (list: Named[], id: string | null) => (id ? list.find((x) => x.id === id)?.name ?? "Removed" : null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await saveScheduleAction(editing, {
      ...draft,
      ownerAgentId: draft.ownerAgentId || null,
      projectId: draft.projectId || null,
      intervalMinutes: draft.frequency === "minutes" ? draft.intervalMinutes : null,
      dayOfMonth: draft.frequency === "monthly" ? draft.dayOfMonth : null,
    });
    setBusy(false);
    if (res.error) return setErr(res.error);
    toast(editing ? "Schedule saved" : "Schedule added");
    setErr(null);
    setEditing(null);
    setDraft(blank(defaultTimezone));
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        {schedules.length ? (
          schedules.map((s) => (
            <article key={s.id} className={`card p-4 ${s.enabled ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{s.title}</h2>
                  <p className="text-sm text-ink-soft">
                    {s.when} <span className="text-ink-faint">({s.timezone})</span>
                  </p>
                </div>
                <span className="rounded px-2 py-0.5 text-xs font-medium text-white" style={{ background: PRIORITY_META[s.priority].color }}>
                  {PRIORITY_META[s.priority].label}
                </span>
              </div>
              {s.description && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-ink-soft">{s.description}</p>}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-soft sm:grid-cols-4">
                <div>
                  <dt className="text-ink-faint">Agent</dt>
                  <dd>{name(agents, s.ownerAgentId) ?? "Whoever fits"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Project</dt>
                  <dd>{name(projects, s.projectId) ?? "None"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Next</dt>
                  <dd>{whenNext(s.enabled ? s.nextRunAt : null)}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Last</dt>
                  <dd>{s.lastRunAt ? `${timeAgo(s.lastRunAt)} · ${s.runCount} runs` : "Not yet"}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={async () => {
                    const r = await runScheduleNowAction(s.id);
                    toast(r.taskId ? "Task added to Ready" : "Nothing added");
                    router.refresh();
                  }}
                >
                  Run now
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={async () => {
                    await setScheduleEnabledAction(s.id, !s.enabled);
                    router.refresh();
                  }}
                >
                  {s.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setEditing(s.id);
                    setDraft(fromRow(s));
                    setErr(null);
                  }}
                >
                  Edit
                </button>
                {s.lastTaskId && (
                  <Link href={`/?task=${s.lastTaskId}`} className="btn-ghost text-xs">
                    Last task
                  </Link>
                )}
                <button
                  type="button"
                  className="btn-danger ml-auto text-xs"
                  onClick={async () => {
                    await deleteScheduleAction(s.id);
                    router.refresh();
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="card p-8 text-center text-sm text-ink-soft">
            Nothing scheduled yet. Add recurring work here, or ask your chief of staff: &ldquo;every morning at 8, send me a summary of the news in my field&rdquo;.
          </div>
        )}
      </section>

      <form className="card flex flex-col gap-3 self-start p-4" onSubmit={save}>
        <h2 className="font-semibold">{editing ? "Edit schedule" : "Add a schedule"}</h2>
        <div>
          <label className="label" htmlFor="s-title">Task title</label>
          <input id="s-title" className="input" value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Morning summary" />
        </div>
        <div>
          <label className="label" htmlFor="s-desc">What to do each time</label>
          <textarea id="s-desc" className="input min-h-[90px]" value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="Search the news about AI agents from the last day and send me the 5 most important items, with links." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="s-agent">Agent</label>
            <select id="s-agent" className="input" value={draft.ownerAgentId} onChange={(e) => set("ownerAgentId", e.target.value)}>
              <option value="">Whoever fits</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s-project">Project</label>
            <select id="s-project" className="input" value={draft.projectId} onChange={(e) => set("projectId", e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="s-freq">How often</label>
          <select id="s-freq" className="input" value={draft.frequency} onChange={(e) => set("frequency", e.target.value as ScheduleFrequency)}>
            {SCHEDULE_FREQUENCIES.map((f) => (
              <option key={f} value={f}>{FREQ_LABELS[f]}</option>
            ))}
          </select>
        </div>
        {draft.frequency === "minutes" ? (
          <div>
            <label className="label" htmlFor="s-int">Minutes between runs (at least 15)</label>
            <input id="s-int" type="number" min={15} className="input" value={draft.intervalMinutes} onChange={(e) => set("intervalMinutes", Number(e.target.value))} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="s-time">{draft.frequency === "hourly" ? "At minute (HH:MM)" : "Time"}</label>
              <input id="s-time" type="time" className="input" value={draft.timeOfDay} onChange={(e) => set("timeOfDay", e.target.value)} />
            </div>
            {draft.frequency === "monthly" && (
              <div>
                <label className="label" htmlFor="s-dom">Day of month</label>
                <input id="s-dom" type="number" min={1} max={28} className="input" value={draft.dayOfMonth} onChange={(e) => set("dayOfMonth", Number(e.target.value))} />
              </div>
            )}
          </div>
        )}
        {draft.frequency === "weekly" && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
            {DAYS.map((d, i) => {
              const on = draft.weekdays.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-sm ${on ? "border-brand bg-brand text-white" : "border-line"}`}
                  onClick={() => set("weekdays", on ? draft.weekdays.filter((x) => x !== i) : [...draft.weekdays, i].sort())}
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="s-tz">Time zone</label>
            <input id="s-tz" className="input" value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="s-pri">Priority</label>
            <select id="s-pri" className="input" value={draft.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{PRIORITY_META[p].label}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.skipIfOpen} onChange={(e) => set("skipIfOpen", e.target.checked)} />
          Skip a run while the last task is still open
        </label>
        <p className="text-xs text-ink-faint">Each run uses the agent&apos;s model, so it counts toward your budgets on Usage &amp; costs.</p>
        {err && <p className="text-sm text-[#d83a52]">{err}</p>}
        <div className="flex justify-end gap-2">
          {editing && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEditing(null);
                setDraft(blank(defaultTimezone));
                setErr(null);
              }}
            >
              Cancel
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={busy}>
            {editing ? "Save" : "Add schedule"}
          </button>
        </div>
      </form>
    </div>
  );
}
