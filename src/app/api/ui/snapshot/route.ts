import { getSnapshot } from "@/lib/data";
import { pollResponse } from "@/lib/etag";

export const dynamic = "force-dynamic";

/** Live data for the dashboard. Protected by the dashboard password in middleware. */
export async function GET(req: Request) {
  return pollResponse(req, await getSnapshot());
}
