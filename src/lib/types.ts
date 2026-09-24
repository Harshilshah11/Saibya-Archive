// Shared domain types for the Saibya archive.
//
// Bucket layout (written by cloud_sync on the robot):
//   <robot_id>/sessions/<session_id>/
//     session.json                     metadata; status/ended_at set when the session ends
//     video/<cam>/*.ts                 DVR MPEG-TS segments overlapping the session
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
  /** e.g. RECORDING, COMPLETED */
  status?: string;
  started_at?: string;
  started_unix?: number;
  ended_at?: string | null;
  ended_unix?: number | null;
  stop_reason?: string | null;
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
  /** epoch ms */
  start: number | null;
  /** epoch ms */
  end: number | null;
  durationSec: number | null;
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
