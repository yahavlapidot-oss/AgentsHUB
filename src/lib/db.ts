import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { agentshubClient?: Client };

function makeClient(): Client {
  const url = process.env.DATABASE_URL ?? "file:./data/agentshub.db";
  // SQLite can't create the folder itself; without it even `next build` fails.
  if (url.startsWith("file:")) mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  return createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
}

// Reuse one client across hot reloads in development.
const client = globalForDb.agentshubClient ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForDb.agentshubClient = client;

export const db: DB = drizzle(client, { schema });
