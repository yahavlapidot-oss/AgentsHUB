import { pollResponse } from "@/lib/etag";
import { getLiveWork } from "@/lib/live-work";

export const dynamic = "force-dynamic";

/** Live workspace data. Protected by the dashboard password in middleware. */
export async function GET(req: Request) {
  return pollResponse(req, await getLiveWork());
}
