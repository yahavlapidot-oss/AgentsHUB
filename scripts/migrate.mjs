// Applies database migrations. Runs before the server starts in production,
// so it only uses runtime dependencies (no drizzle-kit, no tsx).
//
// Before migrating a local SQLite file it saves a copy next to it, in
// backups/pre-migrate-<time>.db, and keeps the newest BACKUPS_KEEP (default 10).
// To roll back: stop the service, copy a backup over the database file, and
// redeploy the previous commit.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const url = process.env.DATABASE_URL ?? "file:./data/agentshub.db";
const file = url.startsWith("file:") ? url.slice("file:".length) : null;
if (file) mkdirSync(dirname(file), { recursive: true });

const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

if (file && existsSync(file) && statSync(file).size > 0 && process.env.BACKUP_ON_MIGRATE !== "0") {
  const dir = join(dirname(file), "backups");
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `pre-migrate-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  // VACUUM INTO writes a consistent copy even while the database is in use.
  await client.execute({ sql: "VACUUM INTO ?", args: [target] });
  const keep = Number(process.env.BACKUPS_KEEP ?? 10);
  const old = readdirSync(dir)
    .filter((f) => f.startsWith("pre-migrate-") && f.endsWith(".db"))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) rmSync(join(dir, f));
  console.log(`Backed up the database to ${target}`);
}

await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
client.close();
console.log("Database is up to date.");
