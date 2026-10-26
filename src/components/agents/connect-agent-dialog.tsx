"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createAgentAction, makeReviewerAction, setChiefAction } from "@/app/actions";
import { AGENT_TEMPLATES, type AgentTemplate } from "@/lib/agent-templates";
import { PROVIDER_META } from "@/lib/format";
import { PROVIDERS, type Provider } from "@/lib/schema";
import { connectSnippets, mcpSnippets } from "@/lib/snippets";
import { useLive } from "../live";
import { CopyBox, Modal } from "../ui";

type Mode = "hosted" | "mcp" | "api";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "hosted", label: "AgentsHUB runs it", hint: "Picks up Ready tasks by itself, using your API key for the model." },
  { id: "mcp", label: "Claude Code / Codex", hint: "Connects over MCP. Claude Code can also report every step through hooks." },
  { id: "api", label: "My own code", hint: "Your script calls the board's REST API." },
];

export function ConnectAgentDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("hosted");
  const [instructions, setInstructions] = useState("");
  const [lead, setLead] = useState(false);
  const [computer, setComputer] = useState(false);
  const { refresh } = useLive();
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState(PROVIDER_META.anthropic.models[0]);
  const [name, setName] = useState("");
  const [machine, setMachine] = useState("");
  const [skills, setSkills] = useState("");
  const [result, setResult] = useState<{ id: string; token: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const [origin, setOrigin] = useState("");

  function applyTemplate(t: AgentTemplate | null) {
    setTemplate(t);
    if (!t) return;
    setName(t.name);
    setProvider(t.provider);
    setModel(t.model);
    setSkills(t.skills.join(", "));
    setInstructions(t.instructions);
    setComputer(Boolean(t.computer));
    setLead(Boolean(t.lead));
  }
  useEffect(() => setOrigin(window.location.origin), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr("Give the agent a name.");
    if (!model.trim()) return setErr("Pick or type a model.");
    if (mode === "hosted" && provider === "custom") return setErr("AgentsHUB can run Claude, GPT or Gemini agents.");
    try {
      const r = await createAgentAction({
        name,
        provider,
        model,
        machine: machine || null,
        skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
        kind: mode === "hosted" ? "hosted" : mode === "mcp" ? "mcp" : "sdk",
        instructions: mode === "hosted" ? instructions : "",
        role: lead ? "lead" : "member",
        sandboxEnabled: mode === "hosted" && computer,
      });
      if (mode === "hosted" && template?.becomes === "chief") await setChiefAction(r.id);
      if (mode === "hosted" && template?.becomes === "reviewer") await makeReviewerAction(r.id);
      setResult(r);
      await refresh();
    } catch {
      setErr("Could not create the agent. Check the fields and try again.");
    }
  }

  if (result && mode === "hosted") {
    return (
      <Modal title={`${name} is on the team`} onClose={onClose}>
        <div className="flex flex-col gap-4 text-sm">
          <p>
            AgentsHUB will run this agent with {PROVIDER_META[provider].label} ({model}). It takes tasks in <b>Ready</b> that are
            assigned to it or to nobody, splits big ones into subtasks, and reports every step here.
          </p>
          {template?.becomes === "chief" && <p>It&apos;s your chief of staff now: talk to it in the HQ chat (and on Telegram, if you set it up).</p>}
          {template?.becomes === "reviewer" && <p>It now reviews finished high and critical tasks before they reach you. Change this in Settings → Quality check.</p>}
          <p className="text-ink-soft">
            The server needs the provider&apos;s API key ({provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"}).
            Without it, the agent&apos;s first task stops with an error on the board.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => router.push(`/agents/${result.id}`)}>Open agent</button>
            <button type="button" className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  if (result && mode === "mcp") {
    const m = mcpSnippets(origin, result.token);
    return (
      <Modal title={`${name} is ready to connect`} onClose={onClose} wide>
        <div className="flex flex-col gap-4">
          <div className="rounded-md bg-[#fff6e5] p-3 text-sm text-[#7a4a00]">
            Copy these now. The API key inside them is shown only once.
          </div>
          <CopyBox label="Claude Code: add the board's tools" text={m.claudeMcp} />
          <CopyBox label="Claude Code: download the hook (reports every step, obeys pause and approvals)" text={m.hookInstall} />
          <CopyBox label="Claude Code: merge into ~/.claude/settings.json" text={m.claudeHooks} />
          <CopyBox label="Codex" text={m.codex} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => router.push(`/agents/${result.id}`)}>Open agent</button>
            <button type="button" className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  if (result) {
    const s = connectSnippets(origin, result.token, provider, model);
    return (
      <Modal title={`${name} is ready to connect`} onClose={onClose} wide>
        <div className="flex flex-col gap-4">
          <div className="rounded-md bg-[#fff6e5] p-3 text-sm text-[#7a4a00]">
            Copy this API key now. It is shown only once. If you lose it, create a new one from the agent&apos;s page.
          </div>
          <CopyBox label="API key" text={result.token} />
          <CopyBox label="Test it from a terminal" text={s.curl} />
          <CopyBox label={`Report from your ${PROVIDER_META[provider].label} agent (TypeScript)`} text={s.code} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => router.push(`/agents/${result.id}`)}>Open agent</button>
            <button type="button" className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Connect an agent" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset>
          <legend className="label">How does it run?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  if (m.id === "hosted" && provider === "custom") {
                    setProvider("anthropic");
                    setModel(PROVIDER_META.anthropic.models[0]);
                  }
                }}
                aria-pressed={mode === m.id}
                className={`rounded-md border px-2 py-2 text-left text-sm ${mode === m.id ? "border-2 border-[#0073ea]" : "border-line hover:bg-canvas"}`}
              >
                <div className="font-medium">{m.label}</div>
                <div className="mt-0.5 text-xs text-ink-soft">{m.hint}</div>
              </button>
            ))}
          </div>
        </fieldset>
        {mode === "hosted" && (
          <fieldset>
            <legend className="label">Start from a template (optional)</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AGENT_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.blurb}
                  aria-pressed={template?.id === t.id}
                  onClick={() => applyTemplate(template?.id === t.id ? null : t)}
                  className={`rounded-md border px-2 py-1.5 text-left text-sm ${template?.id === t.id ? "border-2 border-[#0073ea]" : "border-line hover:bg-canvas"}`}
                >
                  <span className="mr-1">{t.icon}</span>
                  <span className="font-medium">{t.name}</span>
                </button>
              ))}
            </div>
            {template && <p className="mt-1 text-xs text-ink-soft">{template.blurb}</p>}
          </fieldset>
        )}
        <fieldset>
          <legend className="label">Model provider</legend>
          <div className="grid grid-cols-4 gap-2">
            {PROVIDERS.filter((p) => mode !== "hosted" || p !== "custom").map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setProvider(p);
                  setModel(PROVIDER_META[p].models[0] ?? "");
                }}
                aria-pressed={provider === p}
                className={`rounded-md border px-2 py-2 text-sm font-medium ${provider === p ? "border-2" : "border-line text-ink-soft hover:bg-canvas"}`}
                style={provider === p ? { borderColor: PROVIDER_META[p].color, color: PROVIDER_META[p].color } : undefined}
              >
                {PROVIDER_META[p].label}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="ca-name">Agent name</label>
          <input id="ca-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Backend builder" />
        </div>
        <div>
          <label className="label" htmlFor="ca-model">Model</label>
          <input id="ca-model" className="input font-mono" list="ca-models" value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="ca-models">
            {PROVIDER_META[provider].models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="ca-machine">Runs on (optional)</label>
            <input id="ca-machine" className="input" value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="MacBook, cloud…" />
          </div>
          <div>
            <label className="label" htmlFor="ca-skills">Skills (comma separated)</label>
            <input id="ca-skills" className="input" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="frontend, tests" />
          </div>
        </div>
        {mode === "hosted" && (
          <div>
            <label className="label" htmlFor="ca-instructions">Instructions (optional)</label>
            <textarea
              id="ca-instructions"
              className="input min-h-[80px]"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="You are our researcher. Answer with sources and keep summaries short."
            />
          </div>
        )}
        {mode === "hosted" && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={computer} onChange={(e) => setComputer(e.target.checked)} />
            <span>
              <span className="font-medium">Cloud computer</span>
              <span className="block text-xs text-ink-faint">
                Gets its own Linux sandbox for each task to write, run and test code, and saves the files on the task. Needs E2B_API_KEY on the server.
              </span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={lead} onChange={(e) => setLead(e.target.checked)} />
          <span>
            <span className="font-medium">Team lead</span>
            <span className="block text-xs text-ink-faint">New tasks go to the lead first. It splits them and assigns the pieces to the right agents.</span>
          </span>
        </label>
        {err && <p className="text-sm text-[#d83a52]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">{mode === "hosted" ? "Add agent" : "Create API key"}</button>
        </div>
      </form>
    </Modal>
  );
}
