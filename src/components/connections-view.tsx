"use client";

import { useState } from "react";
import { addConnectionAction, deleteConnectionAction, testConnectionAction, updateConnectionAction, type ConnectionInput } from "@/app/connection-actions";
import type { ConnectionService, PublicConnection } from "@/lib/schema";
import { Card, Steps } from "./settings/notification-cards";
import { toast } from "./toast";
import { CopyBox, EmptyState } from "./ui";

type AgentRef = { id: string; name: string };

const SERVICE_LABELS: Record<ConnectionService, string> = { github: "GitHub", google: "Google", railway: "Railway", mcp: "MCP server" };
const SERVICE_ICONS: Record<ConnectionService, string> = { github: "🐙", google: "📧", railway: "🚂", mcp: "🔌" };

export function ConnectionsView({
  connections,
  agents,
  google,
  keySource,
  notice,
}: {
  connections: PublicConnection[];
  agents: AgentRef[];
  google: { configured: boolean; redirectUri: string };
  keySource: "connections_key" | "dashboard_password" | null;
  notice: string | null;
}) {
  const [adding, setAdding] = useState<Exclude<ConnectionService, "google"> | null>(null);
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      {notice && <div className="card p-3 text-sm">{notice}</div>}
      {keySource !== "connections_key" && (
        <div className="card border-l-4 border-l-[#fdab3d] p-3 text-sm text-ink-soft">
          {keySource === "dashboard_password"
            ? "Secrets are encrypted with a key made from DASHBOARD_PASSWORD. Set CONNECTIONS_KEY (any long random text) on the server so a password change doesn't lock them."
            : "Set CONNECTIONS_KEY (any long random text) on the server before adding connections."}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" onClick={() => setAdding("github")}>
          🐙 Add GitHub
        </button>
        {google.configured ? (
          <a className="btn-ghost" href="/api/connections/google/start">
            📧 Connect Google
          </a>
        ) : null}
        <button type="button" className="btn-ghost" onClick={() => setAdding("railway")}>
          🚂 Add Railway
        </button>
        <button type="button" className="btn-ghost" onClick={() => setAdding("mcp")}>
          🔌 Add MCP server
        </button>
      </div>

      {adding && <AddForm service={adding} agents={agents} onDone={() => setAdding(null)} />}

      {connections.length === 0 && !adding ? (
        <EmptyState title="No connections yet" hint="Add an account so your agents can read your repos, mail and calendar, or check your deployments. Anything that sends or changes something asks you first." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {connections.map((c) => (
            <ConnectionCard key={c.id} c={c} agents={agents} />
          ))}
        </div>
      )}

      {!google.configured && (
        <Card title="📧 Google (Gmail, Calendar, Drive)" state={{ ok: false, label: "Not set up" }}>
          <Steps
            items={[
              <>In Google Cloud Console, create a project and turn on the Gmail, Calendar and Drive APIs (free).</>,
              <>Under OAuth consent screen, pick External and add yourself as a test user (publish the app later so the sign-in doesn&apos;t expire after 7 days).</>,
              <>Create an OAuth client of type Web application with this redirect address:</>,
              <CopyBox key="r" text={google.redirectUri} />,
              <>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server and redeploy. A Connect Google button appears here.</>,
            ]}
          />
        </Card>
      )}
    </div>
  );
}

function AgentPicker({ agents, value, onChange }: { agents: AgentRef[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div>
      <span className="label">Which agents may use it</span>
      <div className="flex flex-wrap gap-2 text-sm">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
          All hosted agents
        </label>
        {agents.map((a) => (
          <label key={a.id} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={value.includes(a.id)}
              onChange={(e) => onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))}
            />
            {a.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function AddForm({ service, agents, onDone }: { service: Exclude<ConnectionService, "google">; agents: AgentRef[]; onDone: () => void }) {
  const [label, setLabel] = useState(SERVICE_LABELS[service]);
  const [secret, setSecret] = useState("");
  const [extra, setExtra] = useState("");
  const [choice, setChoice] = useState(service === "railway" ? "account" : "writes");
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const input: ConnectionInput =
      service === "github"
        ? { service, label, secret, defaultRepo: extra, agentIds }
        : service === "railway"
          ? { service, label, secret, tokenType: choice as "account" | "project", agentIds }
          : { service, label, secret, url: extra, approval: choice as "writes" | "always" | "never", agentIds };
    const r = await addConnectionAction(input);
    setBusy(false);
    if (r.error) toast(r.error, "error");
    if (r.id) {
      if (!r.error) toast(`${SERVICE_LABELS[service]} connected`);
      onDone();
    }
  };

  return (
    <Card title={`${SERVICE_ICONS[service]} Add ${SERVICE_LABELS[service]}`}>
      {service === "github" && (
        <Steps
          items={[
            <>
              On GitHub, open Settings → Developer settings → Fine-grained tokens and create one for the repos agents may use.
            </>,
            <>Give it Contents, Issues and Pull requests (read and write) and Metadata (read). Paste it below.</>,
          ]}
        />
      )}
      {service === "railway" && (
        <Steps items={[<>In Railway, open Account settings → Tokens (or a project&apos;s Settings → Tokens for one project) and create a token.</>, <>Paste it below and pick its type.</>]} />
      )}
      {service === "mcp" && (
        <p className="text-sm text-ink-soft">
          Any MCP server with a Streamable HTTP address (Notion, Linear, Slack, your own). Its tools appear for your agents as mcp_&lt;name&gt;_&lt;tool&gt;.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="c-label">Name</label>
          <input id="c-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {service === "github" && (
          <div>
            <label className="label" htmlFor="c-repo">Default repo (optional)</label>
            <input id="c-repo" className="input" placeholder="owner/repo" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
        )}
        {service === "railway" && (
          <div>
            <label className="label" htmlFor="c-type">Token type</label>
            <select id="c-type" className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="account">Account or workspace token</option>
              <option value="project">Project token</option>
            </select>
          </div>
        )}
        {service === "mcp" && (
          <div>
            <label className="label" htmlFor="c-url">Server address</label>
            <input id="c-url" className="input" placeholder="https://…/mcp" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
        )}
      </div>
      <div>
        <label className="label" htmlFor="c-secret">
          {service === "mcp" ? "Bearer token, or a JSON object of headers (optional)" : "Token"}
        </label>
        <input id="c-secret" type="password" autoComplete="off" className="input" value={secret} onChange={(e) => setSecret(e.target.value)} />
      </div>
      {service === "mcp" && <ApprovalSelect value={choice} onChange={setChoice} />}
      <AgentPicker agents={agents} value={agentIds} onChange={setAgentIds} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? "Checking…" : "Save and test"}
        </button>
      </div>
    </Card>
  );
}

function ApprovalSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label" htmlFor="c-approval">Ask me before</label>
      <select id="c-approval" className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="writes">Tools that change something (the server marks the rest read-only)</option>
        <option value="always">Every call</option>
        <option value="never">Never (only for servers that can&apos;t change anything)</option>
      </select>
    </div>
  );
}

function ConnectionCard({ c, agents }: { c: PublicConnection; agents: AgentRef[] }) {
  const [agentIds, setAgentIds] = useState(c.agentIds);
  const [busy, setBusy] = useState(false);
  const detail =
    c.service === "github"
      ? c.meta.defaultRepo
        ? `Default repo ${String(c.meta.defaultRepo)}`
        : null
      : c.service === "google"
        ? String(c.meta.email ?? "")
        : c.service === "railway"
          ? c.meta.tokenType === "project"
            ? "Project token"
            : "Account token"
          : String(c.meta.url ?? "");
  const save = async (patch: Parameters<typeof updateConnectionAction>[1]) => {
    const r = await updateConnectionAction(c.id, patch);
    toast(r.error ?? "Saved", r.error ? "error" : undefined);
  };
  return (
    <Card
      title={`${SERVICE_ICONS[c.service]} ${c.label}`}
      state={!c.enabled ? { ok: false, label: "Off" } : c.lastError ? { ok: false, label: "Problem" } : { ok: true, label: "Connected" }}
    >
      <div className="text-sm text-ink-soft">
        {SERVICE_LABELS[c.service]}
        {detail ? ` · ${detail}` : ""}
        {c.lastUsedAt ? ` · last used ${new Date(c.lastUsedAt).toLocaleString()}` : ""}
      </div>
      {c.lastError && <div className="rounded bg-[#ffeef0] p-2 text-xs text-[#d83a52]">{c.lastError}</div>}
      {c.service === "mcp" && <ApprovalSelect value={String(c.meta.approval ?? "writes")} onChange={(v) => save({ approval: v as "writes" | "always" | "never" })} />}
      <AgentPicker
        agents={agents}
        value={agentIds}
        onChange={(ids) => {
          setAgentIds(ids);
          void save({ agentIds: ids });
        }}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <label className="mr-auto flex items-center gap-1 text-sm">
          <input type="checkbox" checked={c.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          On
        </label>
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            if (!confirm(`Remove ${c.label}? Agents lose access right away.`)) return;
            await deleteConnectionAction(c.id);
            toast("Removed");
          }}
        >
          Remove
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await testConnectionAction(c.id);
            setBusy(false);
            toast(r.error ?? r.ok ?? "OK", r.error ? "error" : undefined);
          }}
        >
          {busy ? "Testing…" : "Test"}
        </button>
      </div>
    </Card>
  );
}
