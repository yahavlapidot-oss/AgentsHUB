import { ConnectionsView } from "@/components/connections-view";
import { PageHeader } from "@/components/ui";
import { getConnections } from "@/lib/connections";
import { getAgents } from "@/lib/data";
import { googleConfigured, googleRedirectUri } from "@/lib/google";
import { vaultKeySource } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ google?: string; error?: string }> }) {
  const [connections, agents, q] = await Promise.all([getConnections(), getAgents(), searchParams]);
  return (
    <div>
      <PageHeader
        title="Connections"
        subtitle="Accounts and servers your hosted agents may use: GitHub, Google, Railway and any MCP server. Secrets are stored encrypted and never shown to a model."
      />
      <div className="p-4 sm:p-6">
        <ConnectionsView
          connections={connections}
          agents={agents.filter((a) => a.kind === "hosted").map((a) => ({ id: a.id, name: a.name }))}
          google={{ configured: googleConfigured(), redirectUri: googleRedirectUri() }}
          keySource={vaultKeySource()}
          notice={q.google === "connected" ? "Google is connected." : q.error ? `Google: ${q.error}` : null}
        />
      </div>
    </div>
  );
}
