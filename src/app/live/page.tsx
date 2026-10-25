import { LiveWorkspace } from "@/components/live-workspace";
import { PageHeader } from "@/components/ui";
import { getLiveWork } from "@/lib/live-work";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  return (
    <div>
      <PageHeader title="Live workspace" subtitle="What each agent is doing right now: its cloud computer, the commands it runs and their output." />
      <LiveWorkspace initial={await getLiveWork()} />
    </div>
  );
}
