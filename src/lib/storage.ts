/**
 * Where saved files' bytes live. By default they're in the database (fine for
 * small files). Set the ARTIFACT_S3_* variables to keep them in an S3-compatible
 * bucket instead, e.g. a Railway bucket; the database then keeps only the
 * metadata and the object key. Files saved before the switch stay readable.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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
    // Signed with aws4fetch but sent with node's own client: fetch can turn the
    // signed request's body into a stream and drop Content-Length, which S3 refuses (411).
    const signed = await this.client.sign(this.url(key), {
      method: "PUT",
      body: new Uint8Array(bytes),
      headers: { "content-type": contentType },
    });
    const headers: Record<string, string> = Object.fromEntries(signed.headers);
    headers["content-length"] = String(bytes.length);
    const { status, text } = await send(signed.url, headers, bytes);
    if (status < 200 || status >= 300) throw new Error(`Storage upload failed (${status}): ${shortError(text)}`);
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.fetch(this.url(key));
    if (!res.ok) throw new Error(`Storage download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}

function send(url: string, headers: Record<string, string>, body: Buffer): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith("https:") ? httpsRequest : httpRequest)(url, { method: "PUT", headers, timeout: 60_000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("timeout", () => req.destroy(new Error("Storage upload timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

/** "MissingContentLength: You must provide…" instead of the whole XML reply. */
export function shortError(xml: string): string {
  const code = /<Code>([^<]*)<\/Code>/.exec(xml)?.[1];
  const message = /<Message>([^<]*)<\/Message>/.exec(xml)?.[1];
  if (code || message) return [code, message].filter(Boolean).join(": ");
  return xml.slice(0, 200);
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
