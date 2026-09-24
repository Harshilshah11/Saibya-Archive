import "server-only";
import { demoMode } from "../config";
import type { ObjectInfo } from "../types";
import { demoStorage } from "./demo";
import { s3Storage } from "./s3";

/** The only thing the archive logic needs from S3. The demo backend implements the same shape. */
export interface Storage {
  mode: "s3" | "demo";
  /** Immediate "sub-folders" under a prefix (ListObjectsV2 with Delimiter "/"). */
  listPrefixes(prefix: string): Promise<string[]>;
  /** Every object under a prefix, recursively. */
  listObjects(prefix: string): Promise<ObjectInfo[]>;
  /** Object body as text, or null when it does not exist. */
  readText(key: string): Promise<string | null>;
  /** Short-lived GET URL the browser can fetch directly. */
  signedUrl(key: string, downloadName?: string): Promise<string>;
}

export const storage: Storage = demoMode ? demoStorage : s3Storage;
