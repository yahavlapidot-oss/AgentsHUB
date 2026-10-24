// Applies database migrations. Runs before the server starts in production,
// so it only uses runtime dependencies (no drizzle-kit, no tsx).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const url = process.env.DATABASE_URL ?? "file:./data/agentshub.db";
if (url.startsWith("file:")) mkdirSync(dirname(url.slice("file:".length)), { recursive: true });

const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
client.close();
console.log("Database is up to date.");
