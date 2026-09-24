import type { ArchiveFile, FileKind, ObjectInfo, SensorKind } from "./types";

export const SESSIONS_DIR = "sessions";

/** Session metadata written by the robot at start and rewritten when the session ends. */
export const SESSION_FILE = "session.json";

export function sessionPrefix(robotId: string, sessionId: string): string {
  return `${robotId}/${SESSIONS_DIR}/${sessionId}/`;
}

/**
 * Chunk name -> epoch ms. Two forms:
 *   "20260923T090000Z"  UTC (used in app URLs, e.g. ?t=)
 *   "20260924_134701"   robot local time, offset by `localOffsetMin` (robot uploads)
 */
export function parseChunkTime(stem: string, localOffsetMin = 0): number | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})[T_-]?(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?(Z)?/.exec(stem);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, ms, z] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms ? +ms.padEnd(3, "0") : 0);
  return z ? utc : utc - localOffsetMin * 60_000;
}

/** epoch ms -> "20260923T090000Z" */
export function formatChunkTime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Session layout (written by cloud_sync on the robot):
//   video/<cam>/<name>.ts          camera segments
//   sensors/lidar/<stamp>.npz      LiDAR scans
//   sensors/imu/<stamp>.csv.gz     IMU samples
//   session.json                   metadata
export function classify(obj: ObjectInfo, prefix: string, localOffsetMin = 0): ArchiveFile | null {
  const name = obj.key.slice(prefix.length);
  if (!name || name.endsWith("/")) return null;
  const parts = name.split("/");
  const base = parts[parts.length - 1];
  if (base.endsWith(".part") || base.endsWith(".tmp")) return null; // still being written
  const stem = base.replace(/\..*$/, "");
  let kind: FileKind = "meta";
  let camera: string | undefined;
  let sensor: SensorKind | undefined;

  if (parts.length === 3 && parts[0] === "video" && base.endsWith(".ts")) {
    kind = "camera";
    camera = parts[1];
  } else if (parts.length === 3 && parts[0] === "sensors" && parts[1] === "lidar" && base.endsWith(".npz")) {
    kind = "sensors";
    sensor = "lidar";
  } else if (parts.length === 3 && parts[0] === "sensors" && parts[1] === "imu" && /\.csv(\.gz)?$/.test(base)) {
    kind = "sensors";
    sensor = "imu";
  }

  return {
    key: obj.key,
    name,
    kind,
    camera,
    sensor,
    start: kind === "meta" ? undefined : parseChunkTime(stem, localOffsetMin),
    size: obj.size,
    lastModified: obj.lastModified.getTime(),
  };
}

/** cam1, cam2, … cam10 in numeric order; other names alphabetically after them. */
export function sortCameras(cams: Iterable<string>): string[] {
  const num = (c: string) => (/^cam(\d+)$/.exec(c) ? Number(c.slice(3)) : Infinity);
  return [...cams].sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}
