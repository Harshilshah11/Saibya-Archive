import "server-only";
import { config } from "../config";
import { SESSION_FILE, sessionPrefix } from "../keys";
import type { ObjectInfo } from "../types";
import type { Storage } from "./index";

// Generated archive used when no bucket is configured. Object keys follow the real
// layout exactly, so every page and API route runs the same code path as with S3.
// IMU chunks are generated on request (see /api/demo/object); video and LiDAR have no content.

interface DemoSession {
  robotId: string;
  sessionId: string;
  start: number;
  minutes: number;
  cameras: number;
  closed: boolean;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function build(): { objects: ObjectInfo[]; texts: Map<string, string> } {
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const day = 86_400_000;
  const rand = rng(42);
  const sessions: DemoSession[] = [];

  const plan: Array<[robot: string, daysAgo: number, hourUtc: number, minutes: number]> = [
    ["saibya01", 9, 4, 42],
    ["saibya01", 6, 5, 25],
    ["saibya01", 3, 9, 58],
    ["saibya01", 1, 6, 17],
    ["saibya02", 8, 3, 33],
    ["saibya02", 5, 7, 46],
    ["saibya02", 2, 4, 12],
    ["saibya03", 4, 8, 21],
  ];
  plan.forEach(([robotId, daysAgo, hour, minutes], i) => {
    const d = new Date(now - daysAgo * day);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, Math.floor(rand() * 50));
    // one session per robot that was cut off by a power loss
    const interrupted = i === 1 || i === 7;
    sessions.push({
      robotId,
      sessionId: `${localStem(start)}_${Math.floor(rand() * 0xffffffff).toString(16).padStart(8, "0")}`,
      start,
      minutes: interrupted ? Math.floor(minutes / 2) : minutes,
      cameras: 4,
      closed: !interrupted,
    });
  });
  // a session that is recording right now
  sessions.push({
    robotId: "saibya02",
    sessionId: `${localStem(now - 14 * 60_000)}_${Math.floor(rand() * 0xffffffff).toString(16).padStart(8, "0")}`,
    start: now - 14 * 60_000,
    minutes: 13,
    cameras: 4,
    closed: false,
  });

  const objects: ObjectInfo[] = [];
  const texts = new Map<string, string>();
  const chunkMs = config.chunkSec * 1000;
  const offsetMs = config.robotUtcOffsetMin * 60_000;
  const iso = (ms: number) => new Date(ms + offsetMs).toISOString().replace(/\.\d{3}Z$/, "") + offsetLabel();

  for (const s of sessions) {
    const prefix = sessionPrefix(s.robotId, s.sessionId);
    const end = s.start + s.minutes * chunkMs;
    // each chunk lands in S3 a few seconds after it is finished
    const uploadedAt = (t: number) => new Date(Math.min(t + chunkMs + 8_000, now - 30_000));

    const session = {
      session_id: s.sessionId,
      robot_id: s.robotId,
      status: s.closed ? "COMPLETED" : "RUNNING",
      started_at: iso(s.start),
      started_unix: s.start / 1000,
      ended_at: s.closed ? iso(end) : null,
      ended_unix: s.closed ? end / 1000 : null,
      stop_reason: s.closed ? "OPERATOR_STOP" : null,
      max_duration_h: 4.0,
      chunk_s: config.chunkSec,
      video_segment_s: config.chunkSec,
      s3_prefix: `s3://demo/${prefix}`,
      streams: {
        lidar: "sensors/lidar/*.npz — t float64[S] unix, offsets int64[S+1], points float32[N,3] (angle_deg body 0=front CW, range_m, quality)",
        imu: "sensors/imu/*.csv.gz — t_unix, ax, ay, az, gx, gy, gz, mx, my, mz, roll, pitch, yaw, yaw_raw",
        video: "video/<cam>/*.ts — DVR MPEG-TS segments overlapping the session (cam3 = front)",
      },
      counts: { lidar_scans: s.minutes * 60 * 10, imu_samples: s.minutes * 60 * 50 },
    };
    texts.set(prefix + SESSION_FILE, JSON.stringify(session, null, 2));
    objects.push({ key: prefix + SESSION_FILE, size: 860, lastModified: uploadedAt(end) });

    for (let t = s.start; t < end; t += chunkMs) {
      const stem = localStem(t);
      for (let c = 1; c <= s.cameras; c++) {
        objects.push({
          key: `${prefix}video/cam${c}/${stem}.ts`,
          size: Math.floor((70 + rand() * 150) * 1024 * 1024),
          lastModified: uploadedAt(t),
        });
      }
      objects.push({
        key: `${prefix}sensors/lidar/${stem}.npz`,
        size: Math.floor((1.6 + rand() * 0.3) * 1024 * 1024),
        lastModified: uploadedAt(t),
      });
      objects.push({
        key: `${prefix}sensors/imu/${stem}.csv.gz`,
        size: Math.floor((110 + rand() * 20) * 1024),
        lastModified: uploadedAt(t),
      });
    }
  }
  objects.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { objects, texts };
}

/** epoch ms -> "20260924_134701" in robot local time, as the robot names its chunks */
export function localStem(ms: number): string {
  return new Date(ms + config.robotUtcOffsetMin * 60_000).toISOString().slice(0, 19).replace(/-|:/g, "").replace("T", "_");
}

function offsetLabel(): string {
  const m = config.robotUtcOffsetMin;
  const a = Math.abs(m);
  return `${m < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

let cache: { builtAt: number; data: ReturnType<typeof build> } | null = null;
function data() {
  // rebuild every minute so the "active" session keeps looking live
  if (!cache || Date.now() - cache.builtAt > 60_000) cache = { builtAt: Date.now(), data: build() };
  return cache.data;
}

export function demoText(key: string): string | null {
  return data().texts.get(key) ?? null;
}

export const demoStorage: Storage = {
  mode: "demo",

  async listPrefixes(prefix) {
    const set = new Set<string>();
    for (const o of data().objects) {
      if (!o.key.startsWith(prefix)) continue;
      const rest = o.key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) set.add(prefix + rest.slice(0, slash + 1));
    }
    return [...set].sort();
  },

  async listObjects(prefix) {
    return data().objects.filter((o) => o.key.startsWith(prefix));
  },

  async readText(key) {
    return demoText(key);
  },

  async signedUrl(key, downloadName) {
    const q = new URLSearchParams({ key });
    if (downloadName) q.set("download", downloadName);
    return `/api/demo/object?${q}`;
  },
};
