"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteAgentAction, rotateTokenAction, sendCommandAction, setAgentRoleAction, setAgentSandboxAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";
import type { AgentRole, Command, Provider } from "@/lib/schema";
import { connectSnippets } from "@/lib/snippets";
import { useLive } from "../live";
import { CopyBox, Modal } from "../ui";

export function AgentControls({
  agentId,
  agentName,
  paused,
  provider,
  model,
  role,
  commands,
  sandbox,
}: {
  agentId: string;
  agentName: string;
  paused: boolean;
  provider: Provider;
  model: string;
  role: AgentRole;
  commands: Command[];
  /** Hosted agents only: whether it may open a cloud computer, and whether the server can provide one. */
  sandbox: { enabled: boolean; ready: boolean } | null;
}) {
  const router = useRouter();
  const { refresh } = useLive();
  const [redirect, setRedirect] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  async function command(type: Command["type"], text = "") {
    await sendCommandAction(agentId, type, text);
    await refresh();
    router.refresh();
  }

  return (
    <aside className="flex flex-col gap-4">
      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Control</h2>
        <div className="flex flex-wrap gap-2">
          {paused ? (
            <button type="button" className="btn-primary" onClick={() => command("resume")}>Resume</button>
          ) : (
            <button type="button" className="btn-ghost border border-line" onClick={() => command("pause")}>Pause</button>
          )}
          <button type="button" className="btn-danger border border-line" onClick={() => command("stop")}>Stop</button>
        </div>
        <form
          className="mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!redirect.trim()) return;
            await command("redirect", redirect.trim());
            setRedirect("");
          }}
        >
          <label className="label" htmlFor="redirect">Redirect with an instruction</label>
          <textarea id="redirect" className="input min-h-16" value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder="Drop the refactor and fix the failing test first" />
          <button type="submit" className="btn-primary mt-2" disabled={!redirect.trim()}>Send</button>
        </form>
        <p className="mt-3 text-xs text-ink-faint">The agent receives commands on its next heartbeat.</p>
      </section>

      <section className="card p-4">
        <h2 className="mb-1 font-semibold">Team role</h2>
        <p className="mb-3 text-sm text-ink-soft">
          {role === "lead"
            ? "Team lead: new tasks come here first, and it splits and assigns them to the team."
            : "Team member: works on tasks assigned to it, and on open tasks when there's no lead online."}
        </p>
        <button
          type="button"
          className="btn-ghost border border-line"
          onClick={async () => {
            await setAgentRoleAction(agentId, role === "lead" ? "member" : "lead");
            await refresh();
            router.refresh();
          }}
        >
          {role === "lead" ? "Make team member" : "Make team lead"}
        </button>
      </section>

      {sandbox && (
        <section className="card p-4">
          <h2 className="mb-1 font-semibold">Cloud computer</h2>
          <p className="mb-3 text-sm text-ink-soft">
            {sandbox.enabled
              ? "On: for each task the agent gets its own Linux sandbox to write, run and test code. It saves the result as files on the task, and the sandbox is deleted when the task ends."
              : "Off: the agent works with the board tools only and has no file system."}
          </p>
          {sandbox.enabled && !sandbox.ready && (
            <p className="mb-3 rounded-md bg-[#fff6e5] p-2 text-xs text-[#7a4a00]">
              The server has no sandbox key yet (E2B_API_KEY), so the agent works without one until it&apos;s set.
            </p>
          )}
          <button
            type="button"
            className="btn-ghost border border-line"
            onClick={async () => {
              await setAgentSandboxAction(agentId, !sandbox.enabled);
              await refresh();
              router.refresh();
            }}
          >
            {sandbox.enabled ? "Turn off" : "Turn on"}
          </button>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Commands sent</h2>
        {commands.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {commands.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <span className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[11px]">{c.type}</span>
                <span className="min-w-0 flex-1 truncate text-ink-soft">{c.text}</span>
                <span className="shrink-0 text-xs text-ink-faint">{c.status} · {timeAgo(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">None yet.</p>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">API key</h2>
        <p className="mb-3 text-sm text-ink-soft">Lost the key, or think it leaked? Create a new one. The old key stops working right away.</p>
        <button
          type="button"
          className="btn-ghost border border-line"
          onClick={async () => setToken((await rotateTokenAction(agentId)).token)}
        >
          Create new API key
        </button>
        <div className="mt-4 border-t border-line pt-4">
          {confirmDelete ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">Remove {agentName}? Its tasks become unassigned. History stays.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-danger border border-line"
                  onClick={async () => {
                    await deleteAgentAction(agentId);
                    await refresh();
                    router.push("/agents");
                  }}
                >
                  Remove agent
                </button>
                <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)}>Remove agent…</button>
          )}
        </div>
      </section>

      {token && (
        <Modal title="New API key" onClose={() => setToken(null)} wide>
          <div className="flex flex-col gap-4">
            <div className="rounded-md bg-[#fff6e5] p-3 text-sm text-[#7a4a00]">Copy it now. It is shown only once.</div>
            <CopyBox label="API key" text={token} />
            <CopyBox label="Code" text={connectSnippets(origin, token, provider, model).code} />
          </div>
        </Modal>
      )}
    </aside>
  );
}
