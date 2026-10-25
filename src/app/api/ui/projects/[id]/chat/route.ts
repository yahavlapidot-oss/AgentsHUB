import { getMessages } from "@/lib/data";
import { pollResponse } from "@/lib/etag";

export const dynamic = "force-dynamic";

/** The project chat's messages, polled by the chat screen. Protected by the dashboard password in middleware. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return pollResponse(req, { messages: await getMessages({ projectId: id, limit: 300 }), generatedAt: Date.now() });
}
