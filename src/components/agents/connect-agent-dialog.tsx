"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createAgentAction } from "@/app/actions";
import { PROVIDER_META } from "@/lib/format";
import { PROVIDERS, type Provider } from "@/lib/schema";
import { connectSnippets } from "@/lib/snippets";
import { useLive } from "../live";
import { CopyBox, Modal } from "../ui";

export function ConnectAgentDialog({ onClose }: { onClose: () => void }) {
  const { refresh } = useLive();
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState(PROVIDER_META.anthropic.models[0]);
  const [name, setName] = useState("");
  const [machine, setMachine] = useState("");
  const [skills, setSkills] = useState("");
  const [result, setResult] = useState<{ id: string; token: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr("Give the agent a name.");
    if (!model.trim()) return setErr("Pick or type a model.");
    try {
      const r = await createAgentAction({
        name,
        provider,
        model,
        machine: machine || null,
        skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setResult(r);
      await refresh();
    } catch {
      setErr("Could not create the agent. Check the fields and try again.");
    }
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
          <legend className="label">Model provider</legend>
          <div className="grid grid-cols-4 gap-2">
            {PROVIDERS.map((p) => (
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
        {err && <p className="text-sm text-[#d83a52]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">Create API key</button>
        </div>
      </form>
    </Modal>
  );
}
