/**
 * Daily copies of the database next to it (BACKUP_DIR, default <db folder>/backups),
 * the last BACKUP_DAILY_KEEP (7) kept. Uses SQLite's VACUUM INTO, which writes a
 * clean, consistent copy while the app keeps running. They guard against bad
 * data and mistakes; to also survive losing the disk, download one now and then
 * or turn on Railway's volume backups.
 */
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "./db";

const KEEP = Math.max(1, Number(process.env.BACKUP_DAILY_KEEP ?? 7));
const NAME = /^agentshub-\d{4}-\d{2}-\d{2}\.db$/;

export type BackupInfo = { name: string; bytes: number; at: number };

/** The backup folder, or null when the database isn't a local file (a hosted libSQL like Turso keeps its own). */
export function backupDir(): string | null {
  if (process.env.BACKUP_DIR) return resolve(process.env.BACKUP_DIR);
  const url = process.env.DATABASE_URL ?? "file:./data/agentshub.db";
  if (!url.startsWith("file:")) return null;
  return join(dirname(resolve(url.slice("file:".length))), "backups");
}

export function isBackupName(name: string): boolean {
  return NAME.test(name);
}

export function listBackups(): BackupInfo[] {
  const dir = backupDir();
  if (!dir) return [];
  try {
    return readdirSync(dir)
      .filter(isBackupName)
      .map((name) => {
        const st = statSync(join(dir, name));
        return { name, bytes: st.size, at: st.mtimeMs };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export async function runBackup(now = new Date()): Promise<BackupInfo> {
  const dir = backupDir();
  if (!dir) throw new Error("Backups need a local database file (DATABASE_URL=file:…)");
  mkdirSync(dir, { recursive: true });
  const name = `agentshub-${now.toISOString().slice(0, 10)}.db`;
  const path = join(dir, name);
  // VACUUM INTO won't overwrite; today's copy is replaced.
  rmSync(path, { force: true });
  await db.run(sql.raw(`VACUUM INTO '${path.replaceAll("'", "''")}'`));
  for (const old of listBackups().slice(KEEP)) rmSync(join(dir, old.name), { force: true });
  const st = statSync(path);
  return { name, bytes: st.size, at: st.mtimeMs };
}

export function backupPath(name: string): string | null {
  const dir = backupDir();
  return dir && isBackupName(name) ? join(dir, name) : null;
}
