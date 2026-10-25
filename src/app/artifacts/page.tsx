import { ArtifactsList } from "@/components/artifacts-list";
import { RefreshOnTick } from "@/components/refresh-on-tick";
import { PageHeader } from "@/components/ui";
import { getArtifacts } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ArtifactsPage() {
  const artifacts = await getArtifacts({ limit: 1000 });
  return (
    <div>
      <RefreshOnTick />
      <PageHeader
        title="Files"
        subtitle="Everything agents delivered: code, documents, pages and data, with every version. Open a task to see its own files."
      />
      <div className="p-6">
        <ArtifactsList artifacts={artifacts} showTask />
      </div>
    </div>
  );
}
