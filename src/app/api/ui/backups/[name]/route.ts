import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { backupPath } from "@/lib/backups";

export const dynamic = "force-dynamic";

/** Download one backup. Protected by the dashboard password in middleware. */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const path = backupPath(name);
  let size = 0;
  try {
    size = path ? statSync(path).size : 0;
  } catch {
    // Missing: answered below.
  }
  if (!path || !size) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: { "content-type": "application/vnd.sqlite3", "content-length": String(size), "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
