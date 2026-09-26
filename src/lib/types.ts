// Shared domain types for the Saibya archive.
//
// Bucket layout (written by cloud_sync on the robot):
//   <robot_id>/sessions/<session_id>/           real sessions
//   <robot_id>/sim/sessions/<session_id>/       bench simulation (shown as robot "<robot_id>-sim")
//     session.json                     metadata; status/ended_at set when the session ends
//     upload_log.csv                   every upload of the session (written at the end)
//     _COMPLETE.json                   uploaded LAST: every file of the session is in S3
//     video/<cam>/<YYYYMMDD_HHMMSS>.ts DVR MPEG-TS segments overlapping the session
//                                      (video_segment_s long: 600 s real, 60 s simulated)
//     sensors/lidar/<YYYYMMDD_HHMMSS>.npz     LiDAR scans (robot local time)
//     sensors/imu/<YYYYMMDD_HHMMSS>.csv.gz    IMU samples (robot local time)

export type SessionStatus = "active" | "closed" | "interrupted";

export type FileKind = "camera" | "sensors" | "meta";

/** Data type as shown in the UI. LiDAR and IMU are both "sensors" files. */
export type DataType = "camera" | "sensors";

export type SensorKind = "lidar" | "imu";

export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: Date;
}

export interface ArchiveFile {
  key: string;
  /** Path inside the session, e.g. "cam1/20260923T090000Z.ts" */
  name: string;
  kind: FileKind;
  /** Camera folder name under video/ for camera chunks */
  camera?: string;
  /** For sensor chunks */
  sensor?: SensorKind;
  /** Chunk start, epoch ms (parsed from the file name) */
  start?: number;
  size: number;
  lastModified: number;
}

/** session.json */
export interface Manifest {
  session_id?: string;
  robot_id?: string;
  /** RUNNING while recording, then COMPLETED or CLOSED_ON_BOOT */
  status?: string;
  /** true for cloud_sync bench-simulation sessions (synthetic data) */
  simulated?: boolean;
  /** sensor file length, seconds */
  chunk_s?: number;
  /** camera segment length, seconds (DVR_SEGMENT_S: 600 real, 60 simulated) */
  video_segment_s?: number;
  started_at?: string;
  started_unix?: number;
  ended_at?: string | null;
  ended_unix?: number | null;
  stop_reason?: string | null;
  /** trip name typed by the operator at Start */
  trip?: string | null;
  streams?: Record<string, string>;
  counts?: Record<string, number>;
  [key: string]: unknown;
}

export interface KindStats {
  count: number;
  bytes: number;
}

export interface SessionSummary {
  robotId: string;
  sessionId: string;
  status: SessionStatus;
  /** Trip (mission / day) the operator filed the session under, if any */
  trip: string | null;
  /** epoch ms */
  start: number | null;
  /** epoch ms */
  end: number | null;
  durationSec: number | null;
  /** Nominal camera segment length, seconds (from session.json, else VIDEO_SEGMENT_SECONDS) */
  videoSegmentSec: number;
  /** Synthetic data from cloud_sync's simulation mode */
  simulated: boolean;
  /**
   * complete  — _COMPLETE.json present: every file of the session is in S3
   * uploading — stopped, but the robot is still uploading (or offline)
   * unknown   — recorded by a cloud_sync that did not write the marker yet
   */
  upload: "complete" | "uploading" | "unknown";
  cameras: string[];
  hasSensors: boolean;
  hasLidar: boolean;
  hasImu: boolean;
  stats: Record<FileKind, KindStats>;
  totalBytes: number;
  /** Most recent upload in this session, epoch ms */
  lastUpload: number | null;
  manifest: Manifest | null;
}

export interface RobotSummary {
  robotId: string;
  sessions: SessionSummary[];
  totalBytes: number;
  lastUpload: number | null;
  activeSessions: number;
  /** Latest cloud_sync heartbeat (v3 database mode only) */
  link: RobotLinkInfo | null;
}

export interface RobotLinkInfo {
  /** epoch ms */
  seenAt: number;
  sessionId: string | null;
  status: Record<string, unknown>;
}

/** A file as handed to the browser, with a short-lived download URL. */
export interface SignedFile extends ArchiveFile {
  url: string;
}

export interface CameraSegment {
  /** epoch ms */
  start: number;
  /** seconds */
  duration: number;
}

// ── API responses (Server -> web app) ────────────────────────────────────────

/** GET /api/info */
export interface ApiInfo {
  service: string;
  /** "demo" = generated data, no bucket configured */
  mode: "s3" | "demo";
  index: "db" | "s3";
  /** open session with no upload for this long -> "interrupted" */
  interruptedAfterMin: number;
}

/** GET /api/robots/:robotId */
export interface RobotDetail {
  robotId: string;
  sessions: SessionSummary[];
  link: RobotLinkInfo | null;
}

/** One camera of a session, as the player and the download rows need it. */
export interface CameraTrack {
  name: string;
  segments: CameraSegment[];
  bytes: number;
  /** summed segment length, seconds */
  seconds: number;
  /** the whole camera as one MP4 that plays on Windows, macOS and phones (built on first request) */
  mp4Url: string;
}

/** GET /api/robots/:robotId/sessions/:sessionId */
export interface SessionDetail {
  session: SessionSummary;
  /** every file, with download URLs */
  files: SignedFile[];
  cameras: CameraTrack[];
}

/** One session on the /data page: per-stream sizes. */
export interface DataRow {
  robotId: string;
  sessionId: string;
  trip: string | null;
  start: number | null;
  durationSec: number | null;
  status: SessionStatus;
  upload: "complete" | "uploading" | "unknown";
  simulated: boolean;
  cameras: Array<{ camera: string; bytes: number }>;
  imuBytes: number;
  lidarBytes: number;
  /** everything in the session, including session.json */
  totalBytes: number;
}

/** GET /api/data */
export interface DataIndex {
  robots: string[];
  rows: DataRow[];
}
