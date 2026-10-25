import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodTypeAny } from "zod";
import { ConflictError, findAgentByToken } from "./data";
import type { Agent } from "./schema";
import { bearerToken } from "./tokens";

export type RouteCtx<P extends Record<string, string> = Record<string, string>> = { params: Promise<P> };

type AgentHandler<P extends Record<string, string>> = (
  req: NextRequest,
  agent: Agent,
  params: P,
) => Promise<Response>;

/** Wraps an /api/v1 route: authenticates the agent token and maps errors to JSON. */
export function withAgent<P extends Record<string, string> = Record<string, string>>(handler: AgentHandler<P>) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<Response> => {
    const token = bearerToken(req.headers.get("authorization"));
    if (!token) return error(401, "Missing agent token. Send `Authorization: Bearer ahub_...`.");
    const agent = await findAgentByToken(token);
    if (!agent) return error(401, "Unknown agent token. Create a new one on the Agents page.");
    try {
      return await handler(req, agent, await ctx.params);
    } catch (e) {
      if (e instanceof BadRequest) return error(400, e.message, e.issues);
      if (e instanceof TooLarge) return error(413, `Body is over ${MAX_BODY_BYTES} bytes`);
      if (e instanceof ConflictError) return error(409, e.message);
      console.error(e);
      return error(500, "Internal error");
    }
  };
}

export class BadRequest extends Error {
  constructor(message: string, public issues?: unknown) {
    super(message);
  }
}

/** Largest request body the agent API reads (a 5 MB file is about 7 MB as base64 in JSON). */
export const MAX_BODY_BYTES = Number(process.env.API_MAX_BODY_BYTES ?? 10 * 1024 * 1024);

export class TooLarge extends Error {}

/** Reads a JSON body, refusing one bigger than MAX_BODY_BYTES before it's all in memory. */
export async function readJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new TooLarge();
  const reader = req.body?.getReader();
  if (!reader) throw new BadRequest("Body must be JSON");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new TooLarge();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequest("Body must be JSON");
  }
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const raw = await readJson(req);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BadRequest("Invalid body", parsed.error.flatten());
  return parsed.data;
}

export function ok(data: unknown, status = 200): Response {
  return NextResponse.json(data, { status });
}

export function error(status: number, message: string, details?: unknown): Response {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status });
}

export { z };
