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
  ) {
    this.client = new AwsClient({ ...opts, service: "s3" });
  }

  private url(key: string): string {
    const base = this.endpoint.replace(/\/+$/, "");
    return `${base}/${this.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
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

/** The bucket, when it's configured; null means files stay in the database. */
export function getBlobStore(): BlobStore | null {
  const e = process.env;
  if (!e.ARTIFACT_S3_BUCKET || !e.ARTIFACT_S3_ENDPOINT || !e.ARTIFACT_S3_ACCESS_KEY_ID || !e.ARTIFACT_S3_SECRET_ACCESS_KEY) return null;
  return new S3Store(e.ARTIFACT_S3_BUCKET, e.ARTIFACT_S3_ENDPOINT, {
    accessKeyId: e.ARTIFACT_S3_ACCESS_KEY_ID,
    secretAccessKey: e.ARTIFACT_S3_SECRET_ACCESS_KEY,
    region: e.ARTIFACT_S3_REGION || "auto",
  });
}
