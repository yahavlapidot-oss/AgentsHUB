/**
 * Connections: the accounts and servers agents may use (see schema.ts). Secrets
 * are sealed on the way in and opened only inside tools, never sent to the UI
 * or put in a model's context.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { newId } from "./ids";
import { connections, type Connection, type ConnectionService, type PublicConnection } from "./schema";
import { open, seal } from "./vault";

export function toPublic(c: Connection): PublicConnection {
  const { secret, ...rest } = c;
  return { ...rest, hasSecret: Boolean(secret) };
}

export async function getConnections(): Promise<PublicConnection[]> {
  return (await db.select().from(connections).orderBy(desc(connections.createdAt))).map(toPublic);
}

export async function getConnection(id: string): Promise<Connection | null> {
  const [row] = await db.select().from(connections).where(eq(connections.id, id));
  return row ?? null;
}

export async function createConnection(input: { service: ConnectionService; label: string; secret: string; meta?: Record<string, unknown>; agentIds?: string[] }): Promise<Connection> {
  const now = Date.now();
  const [row] = await db
    .insert(connections)
    .values({ id: newId("conn"), service: input.service, label: input.label.slice(0, 120), secret: seal(input.secret), meta: input.meta ?? {}, agentIds: input.agentIds ?? [], createdAt: now, updatedAt: now })
    .returning();
  return row;
}

export async function updateConnection(
  id: string,
  patch: { label?: string; secret?: string; meta?: Record<string, unknown>; agentIds?: string[]; enabled?: boolean; lastError?: string | null },
): Promise<void> {
  const { secret, ...rest } = patch;
  await db
    .update(connections)
    .set({ ...rest, ...(secret !== undefined ? { secret: seal(secret) } : {}), updatedAt: Date.now() })
    .where(eq(connections.id, id));
}

export async function deleteConnection(id: string): Promise<void> {
  await db.delete(connections).where(eq(connections.id, id));
}

export function mayUse(c: Pick<Connection, "agentIds" | "enabled">, agentId: string): boolean {
  return c.enabled && (c.agentIds.length === 0 || c.agentIds.includes(agentId));
}

/** The connections of a service this agent may use, newest first. */
export async function connectionsFor(agentId: string, service?: ConnectionService): Promise<Connection[]> {
  const rows = await db
    .select()
    .from(connections)
    .where(service ? and(eq(connections.service, service), eq(connections.enabled, true)) : eq(connections.enabled, true))
    .orderBy(desc(connections.createdAt));
  return rows.filter((c) => mayUse(c, agentId));
}

/** The services this agent has at least one connection for. */
export async function servicesFor(agentId: string): Promise<Set<ConnectionService>> {
  return new Set((await connectionsFor(agentId)).map((c) => c.service));
}

export class NoConnection extends Error {}

/** The secret of this agent's first connection to a service, opened. */
export async function secretFor(agentId: string, service: ConnectionService): Promise<{ connection: Connection; secret: string }> {
  const [c] = await connectionsFor(agentId, service);
  if (!c) throw new NoConnection(`You have no ${service} connection. Ask the user to add one on the Connections page and give you access.`);
  await db.update(connections).set({ lastUsedAt: Date.now() }).where(eq(connections.id, c.id));
  return { connection: c, secret: open(c.secret) };
}
