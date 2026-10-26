import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "agentshub-backup-"));
process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
process.env.BACKUP_DAILY_KEEP = "2";

let backups: typeof import("../src/lib/backups");
let data: typeof import("../src/lib/data");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  backups = await import("../src/lib/backups");
  data = await import("../src/lib/data");
});

describe("daily backups", () => {
  it("writes a readable copy and keeps only the newest", async () => {
    await data.createTask({ title: "Keep me" });
    const first = await backups.runBackup(new Date("2026-10-24T03:00:00Z"));
    expect(first.name).toBe("agentshub-2026-10-24.db");
    expect(first.bytes).toBeGreaterThan(0);
    await backups.runBackup(new Date("2026-10-25T03:00:00Z"));
    await backups.runBackup(new Date("2026-10-26T03:00:00Z"));
    await backups.runBackup(new Date("2026-10-26T04:00:00Z")); // same day: replaced, not added
    expect(backups.listBackups().map((b) => b.name)).toEqual(["agentshub-2026-10-26.db", "agentshub-2026-10-25.db"]);
    expect(existsSync(join(dir, "backups", "agentshub-2026-10-24.db"))).toBe(false);

    const { createClient } = await import("@libsql/client");
    const copy = createClient({ url: `file:${join(dir, "backups", "agentshub-2026-10-26.db")}` });
    const rows = await copy.execute("select title from tasks");
    expect(rows.rows.map((r) => r.title)).toContain("Keep me");
    copy.close();
  });

  it("only serves backup files by name", () => {
    expect(backups.backupPath("agentshub-2026-10-26.db")).toContain("backups");
    expect(backups.backupPath("../test.db")).toBeNull();
    expect(backups.backupPath("agentshub-2026-10-26.db/../../x")).toBeNull();
  });
});
