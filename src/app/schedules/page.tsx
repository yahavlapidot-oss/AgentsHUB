import { RefreshOnTick } from "@/components/refresh-on-tick";
import { SchedulesView } from "@/components/schedules-view";
import { PageHeader } from "@/components/ui";
import { getAgents, getProjects } from "@/lib/data";
import { DEFAULT_TIMEZONE, describeTiming, getSchedules } from "@/lib/schedules";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const [schedules, agents, projects] = await Promise.all([getSchedules(), getAgents(), getProjects()]);
  return (
    <div>
      <RefreshOnTick />
      <PageHeader
        title="Schedules"
        subtitle="Recurring work. At each time a task is added to Ready for the agent you pick, like a morning summary or a weekly check."
      />
      <div className="p-4 sm:p-6">
        <SchedulesView
          schedules={schedules.map((s) => ({ ...s, when: describeTiming(s) }))}
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          defaultTimezone={DEFAULT_TIMEZONE}
        />
      </div>
    </div>
  );
}
