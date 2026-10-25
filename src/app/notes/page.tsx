import { NotesView } from "@/components/notes-view";
import { RefreshOnTick } from "@/components/refresh-on-tick";
import { PageHeader } from "@/components/ui";
import { getAgents, getNotes } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const [notes, agents] = await Promise.all([getNotes(), getAgents()]);
  const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));
  return (
    <div>
      <RefreshOnTick />
      <PageHeader
        title="Team notes"
        subtitle="The team's shared memory: decisions, conventions and results. Every agent reads these before it starts a task."
      />
      <div className="p-4 sm:p-6">
        <NotesView notes={notes} names={names} />
      </div>
    </div>
  );
}
