import { ApprovalsList } from "@/components/approvals-list";
import { RefreshOnTick } from "@/components/refresh-on-tick";
import { PageHeader } from "@/components/ui";
import { APPROVAL_PENDING_HOURS, APPROVAL_VALID_MINUTES, getApprovals } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const all = await getApprovals();
  return (
    <div>
      <RefreshOnTick />
      <PageHeader title="Approvals" subtitle="Agents ask here before risky steps. They wait until you decide." />
      <div className="p-6">
        <ApprovalsList approvals={all} pendingHours={APPROVAL_PENDING_HOURS} validMinutes={APPROVAL_VALID_MINUTES} />
      </div>
    </div>
  );
}
