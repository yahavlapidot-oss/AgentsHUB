/**
 * Where saved files' bytes live. By default they're in the database (fine for
 * small files). Set the ARTIFACT_S3_* variables to keep them in an S3-compatible
 * bucket instead, e.g. a Railway bucket; the database then keeps only the
 * metadata and the object key. Files saved before the switch stay readable.
 */
import { AwsClient } from "aws4fetch";

export interface BlobStore {
  readonly name: "db" | "s3";
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class S3Store implements BlobStore {
  readonly name = "s3";
  private client: AwsClient;
  constructor(
    private bucket: string,
    private endpoint: string,
    opts: { accessKeyId: string; secretAccessKey: string; region: string },
    /** "virtual" puts the bucket in the host name (Railway's new buckets); "path" puts it in the path. */
    private style: "path" | "virtual" = "path",
  ) {
    this.client = new AwsClient({ ...opts, service: "s3" });
  }

  private url(key: string): string {
    return objectUrl(this.endpoint, this.bucket, key, this.style);
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), {
      method: "PUT",
      body: new Uint8Array(bytes),
      headers: { "content-type": contentType },
    });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.fetch(this.url(key));
    if (!res.ok) throw new Error(`Storage download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export function objectUrl(endpoint: string, bucket: string, key: string, style: "path" | "virtual"): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  const base = new URL(endpoint);
  if (style === "virtual") return `${base.protocol}//${bucket}.${base.host}/${path}`;
  return `${base.origin}${base.pathname.replace(/\/+$/, "")}/${bucket}/${path}`;
}

/** The bucket, when it's configured; null means files stay in the database. */
export function getBlobStore(): BlobStore | null {
  const e = process.env;
  if (!e.ARTIFACT_S3_BUCKET || !e.ARTIFACT_S3_ENDPOINT || !e.ARTIFACT_S3_ACCESS_KEY_ID || !e.ARTIFACT_S3_SECRET_ACCESS_KEY) return null;
  return new S3Store(e.ARTIFACT_S3_BUCKET, e.ARTIFACT_S3_ENDPOINT, {
    accessKeyId: e.ARTIFACT_S3_ACCESS_KEY_ID,
    secretAccessKey: e.ARTIFACT_S3_SECRET_ACCESS_KEY,
    region: e.ARTIFACT_S3_REGION || "auto",
  }, e.ARTIFACT_S3_URL_STYLE === "virtual" ? "virtual" : "path");
}

/** Writes and reads back a small object, so a wrong bucket setting shows up in the logs at startup. */
export async function checkBlobStore(): Promise<"off" | "ok"> {
  const store = getBlobStore();
  if (!store) return "off";
  const stamp = Buffer.from(new Date().toISOString());
  await store.put("health/check.txt", stamp, "text/plain");
  if (!(await store.get("health/check.txt")).equals(stamp)) throw new Error("read back different bytes");
  return "ok";
}
