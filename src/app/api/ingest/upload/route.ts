import { createHash } from "node:crypto";
import { pipeline, Readable, Transform } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { NextResponse, type NextRequest } from "next/server";
import { bearer, robotForToken } from "@/lib/auth";
import { forgetSha256, ingest, sessionComplete, storedFile } from "@/lib/catalog";
import { config, demoMode } from "@/lib/config";
import { dbEnabled } from "@/lib/db";
import { classify, COMPLETE_FILE, contentTypeFor, parseSessionKey, SESSION_FILE } from "@/lib/keys";
import type { Manifest } from "@/lib/types";
import { putObjectStream } from "@/lib/storage/s3";

// v4: the robot sends each finished file here; the Server writes it to S3 and indexes it
// in one step, so robots never hold AWS keys.
//   PUT /api/ingest/upload
//   Authorization: Bearer <device token>
//   X-Object-Key: saibya02/sessions/<id>/video/cam1/20260925_101500.ts
//   X-Content-SHA256: <hex sha256 of the body>
//   Content-Length: <bytes>            <raw file bytes>
// -> 200 { key, size, etag }   stored (the robot may now delete its copy)
//    400 bad key / hash or size mismatch · 401 bad token · 403 key outside the token's robot
//    409 would change stored data · 413 too big · 5xx retry later
// Idempotent: the same key with the same sha256 returns 200 again without re-uploading.
// Overwrite protection: a stored file never changes (a different sha256 for its key is 409),
// and once a session is complete nothing in it can be added or replaced. The one exception is
// session.json, which the robot rewrites when the session stops.
// The body is hashed while it streams into S3, so memory stays flat for any file size.

export const runtime = "nodejs";

// The only non-data files cloud_sync writes. Data files must be video/<cam>/*.ts,
// sensors/lidar/*.npz or sensors/imu/*.csv[.gz] (classify() decides), so a robot token
// can't be used to park arbitrary files in the bucket.
const META_FILES = new Set([SESSION_FILE, COMPLETE_FILE, "upload_log.csv"]);

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

export async function PUT(req: NextRequest) {
  if (!dbEnabled) return fail(503, "No database configured (DATABASE_URL)");
  if (demoMode) return fail(503, "No bucket configured (S3_BUCKET)");
  const robot = await robotForToken(bearer(req));
  if (!robot) return fail(401, "Invalid device token");

  const key = req.headers.get("x-object-key") ?? "";
  const parsed = parseSessionKey(key);
  const prefix = parsed ? key.slice(0, key.length - parsed.name.length) : "";
  const file = parsed ? classify({ key, size: 0, lastModified: new Date() }, prefix) : null;
  if (!parsed || !file) return fail(400, "Bad X-Object-Key: expected <robot>/[sim/]sessions/<session>/<path>");
  if (file.kind === "meta" && !META_FILES.has(parsed.name)) {
    return fail(400, `Not a session file: ${parsed.name} (expected video, LiDAR, IMU or ${[...META_FILES].join(", ")})`);
  }
  if (parsed.owner !== robot) return fail(403, `Token is for robot ${robot}`, { key });

  const want = (req.headers.get("x-content-sha256") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) return fail(400, "X-Content-SHA256 must be 64 hex characters");

  const lengthHeader = req.headers.get("content-length");
  const length = lengthHeader === null ? null : Number(lengthHeader);
  if (length !== null && (!Number.isSafeInteger(length) || length < 0)) return fail(400, "Bad Content-Length");
  if (length !== null && length > config.uploadMaxBytes) {
    return fail(413, `File is larger than ${config.uploadMaxBytes / 1024 / 1024} MB`);
  }

  const prev = await storedFile(key);
  if (prev && prev.sha256 === want && (length === null || prev.size === length)) {
    await req.body?.cancel().catch(() => {});
    return NextResponse.json({ key, size: prev.size, etag: null, duplicate: true });
  }
  if (await sessionComplete(parsed.robotId, parsed.sessionId)) {
    return fail(409, "Session is complete: its files can no longer change", { key });
  }
  if (prev?.sha256 && parsed.name !== SESSION_FILE) {
    return fail(409, "Already stored with different content: stored files never change", { key });
  }

  // Count, hash and cap the bytes on their way to S3. session.json is also kept in memory
  // (a few KB) because its body is the session manifest.
  const hash = createHash("sha256");
  const keepBody = parsed.name === SESSION_FILE;
  const kept: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      if (size > config.uploadMaxBytes) {
        tooLarge = true;
        return done(new Error("upload too large"));
      }
      hash.update(chunk);
      if (keepBody) kept.push(chunk);
      done(null, chunk);
    },
  });
  const source = req.body ? Readable.fromWeb(req.body as NodeWebStream<Uint8Array>) : Readable.from([]);
  pipeline(source, meter, () => {});

  let etag: string;
  try {
    etag = await putObjectStream(key, meter, contentTypeFor(key));
  } catch (err) {
    if (tooLarge) return fail(413, `File is larger than ${config.uploadMaxBytes / 1024 / 1024} MB`);
    console.error(`upload ${key}:`, err);
    return fail(502, "Could not store the file in S3, retry later");
  }

  const got = hash.digest("hex");
  if (got !== want || (length !== null && size !== length)) {
    await forgetSha256(key);
    return fail(400, "Body does not match X-Content-SHA256 / Content-Length", { size, sha256: got });
  }

  let manifest: Manifest | null | undefined;
  if (keepBody) {
    try {
      manifest = JSON.parse(Buffer.concat(kept).toString("utf8")) as Manifest;
    } catch {
      manifest = null;
    }
  }
  // Server time: the object is stored now, whatever the robot's clock says.
  const result = await ingest([{ key, size, manifest, sha256: got }], robot);
  if (!result.accepted) return fail(400, result.rejected[0]?.error ?? "Rejected", { key });
  return NextResponse.json({ key, size, etag });
}
