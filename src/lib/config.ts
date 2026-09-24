import "server-only";

// Server-side configuration. Vercel reserves the AWS_* names, so the S3_* names
// are preferred; AWS_* is accepted as a fallback for local development.
const env = process.env;

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  bucket: env.S3_BUCKET ?? "",
  region: env.S3_REGION ?? env.AWS_REGION ?? "ap-south-1",
  accessKeyId: env.S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY,
  /** Optional comma-separated list; otherwise robots are discovered from top-level prefixes. */
  robotIds: (env.ROBOT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  presignExpiresSec: num(env.PRESIGN_EXPIRES_SECONDS, 3600),
  /** A session whose session.json is not marked ended, with no upload for this long, is "interrupted". */
  interruptedAfterMin: num(env.INTERRUPTED_AFTER_MINUTES, 30),
  /** Nominal sensor chunk length written by cloud_sync. */
  chunkSec: num(env.CHUNK_SECONDS, 60),
  /**
   * Camera segment length when session.json does not say (older sessions). The DVR records
   * 10-minute segments; cloud_sync writes the real value into session.json as video_segment_s.
   */
  videoSegmentSec: num(env.VIDEO_SEGMENT_SECONDS, 600),
  /** UTC offset of the robot clock, used for chunk names like 20260924_134701 (robot local time). */
  robotUtcOffsetMin: offsetMin(env.ROBOT_UTC_OFFSET ?? "+05:30"),
};

/** "+05:30" -> 330 */
function offsetMin(value: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(value.trim());
  if (!m) return 330;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Demo mode serves generated data so the UI works before the bucket exists. */
export const demoMode = env.DEMO_MODE === "1" || !config.bucket;
