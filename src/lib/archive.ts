import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { config } from "./config";
import { classify, SESSION_FILE, SESSIONS_DIR, sessionPrefix, sortCameras } from "./keys";
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

// Everything the UI knows is derived from S3 listings plus session.json:
// no database, as in the v2 design. If the session list gets slow, this is the
// place to put a DynamoDB (or cached index) lookup instead.

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

export const listRobotIds = cache(async (): Promise<string[]> => {
  await connection();
  if (config.robotIds.length) return config.robotIds;
  const prefixes = await storage.listPrefixes("");
  return prefixes.map(lastSegment).filter(Boolean).sort();
});

// A closed session (session.json marked as ended) never changes again, so its listing
// is kept in memory across requests. Open sessions are always listed fresh.
const CLOSED_TTL_MS = 30 * 60_000;
const CLOSED_MAX = 2000;
const closedCache = new Map<string, { at: number; files: ArchiveFile[] }>();

/** All files of one session, classified. */
export const listSessionFiles = cache(async (robotId: string, sessionId: string): Promise<ArchiveFile[]> => {
  const id = `${robotId}/${sessionId}`;
  const hit = closedCache.get(id);
  if (hit && Date.now() - hit.at < CLOSED_TTL_MS) return hit.files;

  const prefix = sessionPrefix(robotId, sessionId);
  const objects = await storage.listObjects(prefix);
  return objects
    .map((o) => classify(o, prefix, config.robotUtcOffsetMin))
    .filter((f): f is ArchiveFile => f !== null)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.name.localeCompare(b.name));
});

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

function statusOf(manifest: Manifest | null, lastUpload: number | null): SessionStatus {
  if (isEnded(manifest)) return "closed";
  const idleMs = lastUpload === null ? Infinity : Date.now() - lastUpload;
  return idleMs > config.interruptedAfterMin * 60_000 ? "interrupted" : "active";
}

const closedSummaries = new Map<string, { at: number; summary: SessionSummary }>();

export const getSession = cache(async (robotId: string, sessionId: string): Promise<SessionSummary | null> => {
  const id = `${robotId}/${sessionId}`;
  const hit = closedSummaries.get(id);
  if (hit && Date.now() - hit.at < CLOSED_TTL_MS) return hit.summary;
  const summary = await buildSession(robotId, sessionId);
  if (summary?.status === "closed") {
    if (closedSummaries.size >= CLOSED_MAX) closedSummaries.delete(closedSummaries.keys().next().value!);
    closedSummaries.set(id, { at: Date.now(), summary });
    if (closedCache.size >= CLOSED_MAX) closedCache.delete(closedCache.keys().next().value!);
    closedCache.set(id, { at: Date.now(), files: await listSessionFiles(robotId, sessionId) });
  }
  return summary;
});

async function buildSession(robotId: string, sessionId: string): Promise<SessionSummary | null> {
  const files = await listSessionFiles(robotId, sessionId);
  if (!files.length) return null;

  let manifest: Manifest | null = null;
  if (files.some((f) => f.name === SESSION_FILE)) {
    try {
      manifest = JSON.parse((await storage.readText(sessionPrefix(robotId, sessionId) + SESSION_FILE)) ?? "null");
    } catch {
      manifest = null; // a broken manifest should not hide the session
    }
  }

  const stats: Record<FileKind, { count: number; bytes: number }> = {
    camera: { count: 0, bytes: 0 },
    sensors: { count: 0, bytes: 0 },
    meta: { count: 0, bytes: 0 },
  };
  const cameras = new Set<string>();
  let hasLidar = false;
  let hasImu = false;
  let firstChunk: number | null = null;
  let lastChunk: number | null = null;
  let lastUpload: number | null = null;
  for (const f of files) {
    stats[f.kind].count++;
    stats[f.kind].bytes += f.size;
    if (f.camera) cameras.add(f.camera);
    if (f.sensor === "lidar") hasLidar = true;
    if (f.sensor === "imu") hasImu = true;
    if (f.start !== undefined) {
      firstChunk = firstChunk === null ? f.start : Math.min(firstChunk, f.start);
      lastChunk = lastChunk === null ? f.start : Math.max(lastChunk, f.start);
    }
    lastUpload = lastUpload === null ? f.lastModified : Math.max(lastUpload, f.lastModified);
  }

  const start = parseTime(manifest?.started_at, manifest?.started_unix) ?? firstChunk;
  const chunkEnd = lastChunk === null ? null : lastChunk + config.chunkSec * 1000;
  const end = parseTime(manifest?.ended_at, manifest?.ended_unix) ?? chunkEnd;

  return {
    robotId,
    sessionId,
    status: statusOf(manifest, lastUpload),
    start,
    end,
    durationSec: start !== null && end !== null ? Math.max(0, Math.round((end - start) / 1000)) : null,
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

export const listSessions = cache(async (robotId: string): Promise<SessionSummary[]> => {
  await connection();
  const prefixes = await storage.listPrefixes(`${robotId}/${SESSIONS_DIR}/`);
  const sessions = await mapLimit(prefixes.map(lastSegment), 8, (id) => getSession(robotId, id));
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

/** Camera chunks in time order with their durations, used for the HLS playlist and time sync. */
export function cameraSegments(files: ArchiveFile[], camera: string): Array<ArchiveFile & CameraSegment> {
  const chunks = files
    .filter((f) => f.kind === "camera" && f.camera === camera && f.start !== undefined)
    .sort((a, b) => a.start! - b.start!);
  return chunks.map((f, i) => {
    const next = chunks[i + 1]?.start;
    // a gap longer than a chunk means recording paused; keep the nominal length then
    const gap = next !== undefined ? (next - f.start!) / 1000 : config.chunkSec;
    const duration = gap > 0 && gap <= config.chunkSec * 1.5 ? gap : config.chunkSec;
    return { ...f, start: f.start!, duration };
  });
}

export const storageMode = () => storage.mode;

/** One "now" per request, so every relative time on a page agrees. */
export const requestNow = cache(() => Date.now());
