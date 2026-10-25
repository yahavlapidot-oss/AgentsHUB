import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diffLines, toHunks } from "../src/lib/diff";

process.env.DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "agentshub-art-")), "test.db")}`;

let data: typeof import("../src/lib/data");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("../src/lib/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  data = await import("../src/lib/data");
});

describe("version diff", () => {
  it("marks added, removed and unchanged lines", () => {
    const lines = diffLines("a\nb\nc\nd\n", "a\nB\nc\nd\ne\n")!;
    expect(lines.map((l) => `${l.type[0]}${l.text}`)).toEqual(["sa", "db", "aB", "sc", "sd", "ae"]);
    expect(lines.find((l) => l.text === "e")?.newNo).toBe(5);
  });

  it("folds long unchanged stretches", () => {
    const old = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const hunks = toHunks(diffLines(old, old.replace("line 25", "changed"))!, 2);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].skippedBefore).toBe(23);
    expect(hunks[0].lines.map((l) => l.type)).toEqual(["same", "same", "del", "add", "same", "same"]);
    expect(toHunks(diffLines("same", "same")!)).toEqual([]);
  });
});

describe("bucket storage", () => {
  const objects = new Map<string, Buffer>();
  let server: Server;
  let signed = 0;

  beforeAll(async () => {
    // A tiny S3 stand-in: PUT stores the body, GET returns it.
    server = createServer((req, res) => {
      if (String(req.headers.authorization ?? "").startsWith("AWS4-HMAC-SHA256")) signed++;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.method === "PUT") {
          objects.set(req.url!, Buffer.concat(chunks));
          res.end();
        } else if (objects.has(req.url!)) {
          res.end(objects.get(req.url!));
        } else {
          res.statusCode = 404;
          res.end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    Object.assign(process.env, {
      ARTIFACT_S3_BUCKET: "files",
      ARTIFACT_S3_ENDPOINT: `http://127.0.0.1:${port}`,
      ARTIFACT_S3_ACCESS_KEY_ID: "key",
      ARTIFACT_S3_SECRET_ACCESS_KEY: "secret",
    });
  });

  afterAll(() => {
    for (const k of ["ARTIFACT_S3_BUCKET", "ARTIFACT_S3_ENDPOINT", "ARTIFACT_S3_ACCESS_KEY_ID", "ARTIFACT_S3_SECRET_ACCESS_KEY"]) delete process.env[k];
    server.close();
  });

  it("keeps the bytes in the bucket and only the key in the database", async () => {
    const task = await data.createTask({ title: "Bucket task" });
    const { artifact } = await data.saveArtifact({ taskId: task.id, agentId: null, path: "out/report.md", content: Buffer.from("# Report") });
    const { db } = await import("../src/lib/db");
    const { artifacts } = await import("../src/lib/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id));
    expect(row.storageKey).toBe(`artifacts/${task.id}/${artifact.id}`);
    expect(row.content.length).toBe(0);
    expect(objects.get(`/files/artifacts/${task.id}/${artifact.id}`)?.toString()).toBe("# Report");
    expect(signed).toBeGreaterThan(0);

    expect((await data.getArtifact(artifact.id))?.content.toString()).toBe("# Report");
  });

  it("builds path-style and virtual-hosted object URLs", async () => {
    const { objectUrl } = await import("../src/lib/storage");
    expect(objectUrl("https://t3.storageapi.dev", "files-abc", "artifacts/t 1/a.md", "virtual")).toBe("https://files-abc.t3.storageapi.dev/artifacts/t%201/a.md");
    expect(objectUrl("http://127.0.0.1:9000/", "files", "a/b", "path")).toBe("http://127.0.0.1:9000/files/a/b");
  });

  it("keeps a file in the database when the bucket upload fails", async () => {
    const saved = process.env.ARTIFACT_S3_ENDPOINT;
    process.env.ARTIFACT_S3_ENDPOINT = "http://127.0.0.1:1";
    const task = await data.createTask({ title: "Bucket down" });
    const { artifact } = await data.saveArtifact({ taskId: task.id, agentId: null, path: "kept.txt", content: Buffer.from("kept") });
    process.env.ARTIFACT_S3_ENDPOINT = saved;
    expect(artifact.storageKey).toBeNull();
    expect((await data.getArtifact(artifact.id))?.content.toString()).toBe("kept");
  });

  it("still reads files saved in the database before the switch", async () => {
    const task = await data.createTask({ title: "Old file" });
    const saved = process.env.ARTIFACT_S3_BUCKET;
    delete process.env.ARTIFACT_S3_BUCKET;
    const { artifact } = await data.saveArtifact({ taskId: task.id, agentId: null, path: "old.txt", content: Buffer.from("old") });
    process.env.ARTIFACT_S3_BUCKET = saved;
    expect((await data.getArtifact(artifact.id))?.content.toString()).toBe("old");
  });
});

describe("delivery report", () => {
  it("puts the task's files up for review and lists them when the task is finished", async () => {
    const { agent } = await data.createAgent({ name: "Deliverer", provider: "anthropic", model: "x", kind: "mcp" });
    const task = await data.createTask({ title: "Deliver", ownerAgentId: agent.id });
    await data.saveArtifact({ taskId: task.id, agentId: agent.id, path: "a.md", content: Buffer.from("1") });
    await data.saveArtifact({ taskId: task.id, agentId: agent.id, path: "a.md", content: Buffer.from("2") });
    const { findTool } = await import("../src/lib/agent-tools");
    const res = (await findTool("complete_task")!.run({ taskId: task.id, summary: "Done" }, { agent })) as {
      files: { path: string; version: number }[];
    };
    expect(res.files).toEqual([{ path: "a.md", version: 2 }]);
    const [latest] = await data.getArtifacts({ taskId: task.id, latestOnly: true });
    expect(latest.status).toBe("in_review");
  });
});
