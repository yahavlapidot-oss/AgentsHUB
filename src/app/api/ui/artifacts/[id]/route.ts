import { getArtifact } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * One saved file. Protected by the dashboard password in middleware. Agents
 * write these files, so they're served in a CSP sandbox: an HTML page can be
 * previewed but runs with no access to the dashboard's origin. ?download=1
 * saves it instead.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = await getArtifact(id);
  if (!artifact) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  const name = artifact.path.split("/").pop() || "file";
  const type = artifact.mimeType.startsWith("text/") || artifact.mimeType === "application/json" ? `${artifact.mimeType}; charset=utf-8` : artifact.mimeType;
  return new Response(new Uint8Array(artifact.content), {
    headers: {
      "content-type": type,
      "content-length": String(artifact.content.length),
      "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "content-security-policy": "sandbox allow-scripts allow-forms allow-popups",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
