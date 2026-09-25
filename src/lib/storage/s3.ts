import "server-only";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dns from "node:dns";
import { Agent } from "node:https";
import type { Readable } from "node:stream";
import { config } from "../config";
import type { ObjectInfo } from "../types";
import type { Storage } from "./index";

let client: S3Client | null = null;

// IPv4 addresses first: on NAT64 networks (some ISPs, phone hotspots) S3 resolves to 64:ff9b::
// addresses first, and connections through that gateway sometimes stall or reset.
const ipv4First: typeof dns.lookup = ((host: string, options: dns.LookupOptions, cb: never) =>
  dns.lookup(host, { ...options, order: "ipv4first" }, cb)) as typeof dns.lookup;

function s3(): S3Client {
  client ??= new S3Client({
    region: config.region,
    // The SDK has no timeouts by default, so one stalled connection held a page for over a minute.
    // Give up on a connect after 3 s (the SDK retries it), and on a socket idle for 30 s.
    requestHandler: {
      connectionTimeout: 3000,
      socketTimeout: 30_000,
      httpsAgent: new Agent({ keepAlive: true, maxSockets: 50, lookup: ipv4First }),
    },
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined, // default chain: the EC2 instance's IAM role on the Server
  });
  return client;
}

/** Streams a body into S3 (multipart above 5 MB, so memory stays flat). Returns the ETag. */
export async function putObjectStream(key: string, body: Readable, contentType: string): Promise<string> {
  const res = await new Upload({
    client: s3(),
    params: { Bucket: config.bucket, Key: key, Body: body, ContentType: contentType },
  }).done();
  return (res.ETag ?? "").replace(/"/g, "");
}

/** GetObject with an optional HTTP Range header ("bytes=0-1023"), for streaming to the browser. */
export async function getObjectRange(key: string, range?: string) {
  return s3().send(new GetObjectCommand({ Bucket: config.bucket, Key: key, Range: range }));
}

export const s3Storage: Storage = {
  mode: "s3",

  async listPrefixes(prefix) {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const res = await s3().send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: prefix,
          Delimiter: "/",
          ContinuationToken: token,
        }),
      );
      for (const p of res.CommonPrefixes ?? []) if (p.Prefix) out.push(p.Prefix);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  },

  async listObjects(prefix) {
    const out: ObjectInfo[] = [];
    let token: string | undefined;
    do {
      const res = await s3().send(
        new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  },

  async readText(key) {
    try {
      const res = await s3().send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      return (await res.Body?.transformToString("utf-8")) ?? null;
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      if ((err as { name?: string }).name === "AccessDenied") return null;
      throw err;
    }
  },

  async signedUrl(key, downloadName) {
    return getSignedUrl(
      s3(),
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ResponseContentDisposition: downloadName
          ? `attachment; filename="${downloadName.replace(/"/g, "")}"`
          : undefined,
      }),
      { expiresIn: config.presignExpiresSec },
    );
  },
};
