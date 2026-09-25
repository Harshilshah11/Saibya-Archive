import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import * as catalog from "./catalog";
import type { FileGroup, RobotLink } from "./catalog";
import { config } from "./config";
import { dbEnabled } from "./db";
import {
  classify,
  COMPLETE_FILE,
  robotOwner,
  SESSION_FILE,
  SESSIONS_DIR,
  SIM_SUFFIX,
  sessionPrefix,
  sessionsPrefix,
  sortCameras,
} from "./keys";
import { storage } from "./storage";
import type {
  ArchiveFile,
  CameraSegment,
  FileKind,
  Manifest,
  RobotSummary,
  SessionStatus,
  SessionSummary,
  SignedFile,
} from "./types";

// Two index backends:
//   v3 (DATABASE_URL set)  robots, sessions and files come from Postgres (see catalog.ts),
//                          filled by the robots' POST /api/ingest and by the S3 re-index.
//   v2 (no database)       everything is derived from S3 listings plus session.json.
// Both reduce a session to per-(kind, camera, sensor) file groups and share summarize().
// File bytes always come straight from S3 through presigned URLs.

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const lastSegment = (prefix: string) => prefix.replace(/\/$/, "").split("/").pop() ?? "";

export const indexMode = (): "db" | "s3" => (dbEnabled ? "db" : "s3");

/** Robot ids as S3 shows them: top-level prefixes, plus "<robot>-sim" for bench simulations. */
export async function listStorageRobotIds(): Promise<string[]> {
  if (config.robotIds.length) return config.robotIds;
  const robots = (await storage.listPrefixes("")).map(lastSegment).filter(Boolean);
  // A robot with bench-simulation sessions (<robot>/sim/sessions/) also appears as "<robot>-sim".
  const sims = await mapLimit(robots, 4, async (r) =>
    (await storage.listPrefixes(`${r}/sim/${SESSIONS_DIR}/`)).length ? `${r}${SIM_SUFFIX}` : null,
  );
  return [...robots, ...sims.filter((s): s is string => s !== null)].sort();
}

/** Session ids of a robot as S3 shows them. */
export async function listStorageSessionIds(robotId: string): Promise<string[]> {
  return (await storage.listPrefixes(sessionsPrefix(robotId))).map(lastSegment);
}

export const listRobotIds = cache(async (): Promise<string[]> => {
  await connection();
  return dbEnabled ? catalog.robotIds() : listStorageRobotIds();
});

// v2 only: a closed session (session.json marked as ended) never changes again, so its
// listing is kept in memory across requests. Open sessions are always listed fresh.
const CLOSED_TTL_MS = 30 * 60_000;
const CLOSED_MAX = 2000;
const closedCache = new Map<string, { at: number; files: ArchiveFile[] }>();

/** All files of one session, straight from S3, classified. */
export async function listStorageFiles(robotId: string, sessionId: string): Promise<ArchiveFile[]> {
  const prefix = sessionPrefix(robotId, sessionId);
  const objects = await storage.listObjects(prefix);
  return objects
    .map((o) => classify(o, prefix, config.robotUtcOffsetMin))
    .filter((f): f is ArchiveFile => f !== null)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.name.localeCompare(b.name));
}

/** All files of one session, classified. */
export const listSessionFiles = cache(async (robotId: string, sessionId: string): Promise<ArchiveFile[]> => {
  if (dbEnabled) return catalog.sessionFiles(robotId, sessionId);
  const id = `${robotId}/${sessionId}`;
  const hit = closedCache.get(id);
  if (hit && Date.now() - hit.at < CLOSED_TTL_MS) return hit.files;
  return listStorageFiles(robotId, sessionId);
});

/** session.json from S3; null when missing or unreadable (a broken manifest should not hide the session). */
export async function readStorageManifest(robotId: string, sessionId: string): Promise<Manifest | null> {
  try {
    return JSON.parse((await storage.readText(sessionPrefix(robotId, sessionId) + SESSION_FILE)) ?? "null");
  } catch {
    return null;
  }
}

function parseTime(iso: unknown, unix?: unknown): number | null {
  if (typeof iso === "string" && iso) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return t;
  }
  return typeof unix === "number" && Number.isFinite(unix) ? unix * 1000 : null;
}

const OPEN_STATES = /^(RECORDING|ACTIVE|RUNNING|STARTING|STARTED|UPLOADING)$/i;

/** session.json is rewritten with ended_at / a final status when the session stops. */
function isEnded(manifest: Manifest | null): boolean {
  if (!manifest) return false;
  if (parseTime(manifest.ended_at, manifest.ended_unix) !== null) return true;
  return typeof manifest.status === "string" && manifest.status !== "" && !OPEN_STATES.test(manifest.status);
}

function statusOf(manifest: Manifest | null, lastUpload: number | null, link: RobotLink | null, sessionId: string): SessionStatus {
  if (isEnded(manifest)) return "closed";
  const window = config.interruptedAfterMin * 60_000;
  // v3: the robot's heartbeat says it is recording this session (even while the uplink is backed up)
  if (link && link.sessionId === sessionId && Date.now() - link.seenAt <= window) return "active";
  const idleMs = lastUpload === null ? Infinity : Date.now() - lastUpload;
  return idleMs > window ? "interrupted" : "active";
}

interface SessionFacts {
  manifest: Manifest | null;
  groups: FileGroup[];
  complete: boolean;
  trip: string | null;
  link: RobotLink | null;
}

/** v2: reduce a session's S3 file list to the same groups the database returns. */
function groupFiles(files: ArchiveFile[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const f of files) {
    const id = `${f.kind}|${f.camera ?? ""}|${f.sensor ?? ""}`;
    let g = groups.get(id);
    if (!g) {
      g = { kind: f.kind, camera: f.camera, sensor: f.sensor, count: 0, bytes: 0, first: null, last: null, uploaded: null };
      groups.set(id, g);
    }
    g.count++;
    g.bytes += f.size;
    if (f.start !== undefined) {
      g.first = g.first === null ? f.start : Math.min(g.first, f.start);
      g.last = g.last === null ? f.start : Math.max(g.last, f.start);
    }
    g.uploaded = g.uploaded === null ? f.lastModified : Math.max(g.uploaded, f.lastModified);
  }
  return [...groups.values()];
}

function summarize(robotId: string, sessionId: string, facts: SessionFacts): SessionSummary | null {
  const { manifest, groups } = facts;
  if (!groups.length) return null;

  const stats: Record<FileKind, { count: number; bytes: number }> = {
    camera: { count: 0, bytes: 0 },
    sensors: { count: 0, bytes: 0 },
    meta: { count: 0, bytes: 0 },
  };
  const cameras = new Set<string>();
  // Simulated cameras write 60 s segments; sessions recorded before cloud_sync wrote
  // video_segment_s into session.json fall back to that, real ones to the DVR's 600 s.
  const videoSegmentSec =
    positive(manifest?.video_segment_s) ?? (manifest?.simulated === true ? 60 : config.videoSegmentSec);
  const sensorChunkSec = positive(manifest?.chunk_s) ?? config.chunkSec;
  let hasLidar = false;
  let hasImu = false;
  let firstChunk: number | null = null;
  let chunkEnd: number | null = null;
  let lastUpload: number | null = null;
  for (const g of groups) {
    stats[g.kind].count += g.count;
    stats[g.kind].bytes += g.bytes;
    if (g.camera) cameras.add(g.camera);
    if (g.sensor === "lidar") hasLidar = true;
    if (g.sensor === "imu") hasImu = true;
    if (g.first !== null && g.last !== null) {
      const len = (g.kind === "camera" ? videoSegmentSec : sensorChunkSec) * 1000;
      firstChunk = firstChunk === null ? g.first : Math.min(firstChunk, g.first);
      chunkEnd = chunkEnd === null ? g.last + len : Math.max(chunkEnd, g.last + len);
    }
    if (g.uploaded !== null) lastUpload = lastUpload === null ? g.uploaded : Math.max(lastUpload, g.uploaded);
  }

  const start = parseTime(manifest?.started_at, manifest?.started_unix) ?? firstChunk;
  const end = parseTime(manifest?.ended_at, manifest?.ended_unix) ?? chunkEnd;

  return {
    robotId,
    sessionId,
    status: statusOf(manifest, lastUpload, facts.link, sessionId),
    trip: facts.trip ?? (typeof manifest?.trip === "string" && manifest.trip ? manifest.trip : null),
    start,
    end,
    durationSec: start !== null && end !== null ? Math.max(0, Math.round((end - start) / 1000)) : null,
    videoSegmentSec,
    simulated: manifest?.simulated === true,
    upload: facts.complete
      ? "complete"
      : manifest && "video_source" in manifest // cloud_sync versions that write the marker
        ? "uploading"
        : "unknown",
    cameras: sortCameras(cameras),
    hasSensors: stats.sensors.count > 0,
    hasLidar,
    hasImu,
    stats,
    totalBytes: stats.camera.bytes + stats.sensors.bytes + stats.meta.bytes,
    lastUpload,
    manifest,
  };
}

/** Latest heartbeat of the robot that uploads this app robot id (v3 only). */
const robotLink = cache(async (robotId: string): Promise<RobotLink | null> =>
  dbEnabled ? catalog.robotLink(robotOwner(robotId)) : null,
);

export { robotLink as getRobotLink };

const closedSummaries = new Map<string, { at: number; summary: SessionSummary }>();

export const getSession = cache(async (robotId: string, sessionId: string): Promise<SessionSummary | null> => {
  if (dbEnabled) {
    const [row] = await catalog.sessionRows(robotId, sessionId);
    return row ? summarize(robotId, sessionId, { ...row, link: await robotLink(robotId) }) : null;
  }
  const id = `${robotId}/${sessionId}`;
  const hit = closedSummaries.get(id);
  if (hit && Date.now() - hit.at < CLOSED_TTL_MS) return hit.summary;
  const files = await listStorageFiles(robotId, sessionId);
  const manifest = files.some((f) => f.name === SESSION_FILE) ? await readStorageManifest(robotId, sessionId) : null;
  const summary = summarize(robotId, sessionId, {
    manifest,
    groups: groupFiles(files),
    complete: files.some((f) => f.name === COMPLETE_FILE),
    trip: null,
    link: null,
  });
  // Cache only when nothing can change any more: closed AND fully uploaded (or a marker-less older session).
  if (summary?.status === "closed" && summary.upload !== "uploading") {
    if (closedSummaries.size >= CLOSED_MAX) closedSummaries.delete(closedSummaries.keys().next().value!);
    closedSummaries.set(id, { at: Date.now(), summary });
    if (closedCache.size >= CLOSED_MAX) closedCache.delete(closedCache.keys().next().value!);
    closedCache.set(id, { at: Date.now(), files });
  }
  return summary;
});

export const listSessions = cache(async (robotId: string): Promise<SessionSummary[]> => {
  await connection();
  let sessions: Array<SessionSummary | null>;
  if (dbEnabled) {
    const link = await robotLink(robotId);
    sessions = (await catalog.sessionRows(robotId)).map((row) => summarize(robotId, row.sessionId, { ...row, link }));
  } else {
    sessions = await mapLimit(await listStorageSessionIds(robotId), 8, (id) => getSession(robotId, id));
  }
  return sessions
    .filter((s): s is SessionSummary => s !== null)
    .sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
});

export const listRobots = cache(async (): Promise<RobotSummary[]> => {
  const ids = await listRobotIds();
  return mapLimit(ids, 4, async (robotId) => {
    const sessions = await listSessions(robotId);
    return {
      robotId,
      sessions,
      totalBytes: sessions.reduce((n, s) => n + s.totalBytes, 0),
      lastUpload: sessions.reduce<number | null>(
        (m, s) => (s.lastUpload === null ? m : Math.max(m ?? 0, s.lastUpload)),
        null,
      ),
      activeSessions: sessions.filter((s) => s.status === "active").length,
      link: await robotLink(robotId),
    };
  });
});

/**
 * Browser URL for a session file. It points at the app's object route, which answers
 * with a redirect to a freshly presigned S3 URL, so links never expire while a page is
 * open. The bytes still come straight from S3.
 */
export function fileUrl(robotId: string, sessionId: string, name: string, download = false): string {
  const path = name.split("/").map(encodeURIComponent).join("/");
  const url = `/api/robots/${encodeURIComponent(robotId)}/sessions/${encodeURIComponent(sessionId)}/object/${path}`;
  return download ? `${url}?download=1` : url;
}

export function withUrls(robotId: string, sessionId: string, files: ArchiveFile[], download = false): SignedFile[] {
  return files.map((f) => ({ ...f, url: fileUrl(robotId, sessionId, f.name, download) }));
}

/**
 * Camera chunks in time order with their durations, used for the HLS playlist and time sync.
 * `segmentSec` is the session's nominal segment length (SessionSummary.videoSegmentSec):
 * 600 s for the real DVR, 60 s for simulated cameras.
 */
export function cameraSegments(
  files: ArchiveFile[],
  camera: string,
  segmentSec: number = config.videoSegmentSec,
): Array<ArchiveFile & CameraSegment> {
  const chunks = files
    .filter((f) => f.kind === "camera" && f.camera === camera && f.start !== undefined)
    .sort((a, b) => a.start! - b.start!);
  return chunks.map((f, i) => {
    const next = chunks[i + 1]?.start;
    // a gap longer than a segment means recording paused (or the camera dropped and
    // the DVR restarted it early); keep the nominal length then
    const gap = next !== undefined ? (next - f.start!) / 1000 : segmentSec;
    const duration = gap > 0 && gap <= segmentSec * 1.5 ? gap : segmentSec;
    return { ...f, start: f.start!, duration };
  });
}

function positive(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export const storageMode = () => storage.mode;

/** One "now" per request, so every relative time on a page agrees. */
export const requestNow = cache(() => Date.now());
