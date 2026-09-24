import "server-only";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";
import type { ObjectInfo } from "../types";
import type { Storage } from "./index";

let client: S3Client | null = null;

function s3(): S3Client {
  client ??= new S3Client({
    region: config.region,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined, // fall back to the default AWS credential chain
  });
  return client;
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
