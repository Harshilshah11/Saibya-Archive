import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { sessionPrefix } from "./keys";
import { storage } from "./storage";
import type { ArchiveFile, CameraSegment } from "./types";

// One camera of a session as a single MP4 that opens by double-click on Windows, macOS
// (QuickTime / Finder preview), iPhone and Android. The archive keeps .ts chunks because the
// web player streams them; a .ts on its own is what most desktop players refuse.
//
// WHAT MAKES IT PLAY ON A MAC, since QuickTime is the pickiest player there is:
//   - H.264 or H.265 video, 8-bit 4:2:0. Anything else is re-encoded to H.264 yuv420p.
//   - H.265 tagged "hvc1", not ffmpeg's default "hev1": QuickTime refuses hev1 outright.
//   - H.264 tagged "avc1" (ffmpeg's default for mp4, set explicitly so it stays that way).
//   - the moov index at the front (+faststart), so Safari and QuickTime can seek before
//     the whole file has arrived, and a byte-range server (the route) to seek with.
//   - audio, when a camera has any, as AAC-LC.
// The chunks are joined with a stream copy when the codec allows, so building an MP4 costs
// disk and network speed, not an encode.

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const CACHE_DIR = process.env.MP4_CACHE_DIR ?? "/var/tmp/saibya-mp4";
/** A built MP4 is kept this long after it was last built, then swept. */
const CACHE_HOURS = Number(process.env.MP4_CACHE_HOURS) > 0 ? Number(process.env.MP4_CACHE_HOURS) : 24;
const NET = ["-protocol_whitelist", "file,http,https,tcp,tls,crypto"];

const building = new Map<string, Promise<string>>();

/** The cached MP4 for these chunks, building it first if needed. Concurrent requests share one build. */
export async function cameraMp4(
  robotId: string,
  sessionId: string,
  camera: string,
  segments: Array<ArchiveFile & CameraSegment>,
): Promise<string> {
  // The name covers every chunk key and size, so a session that gained chunks since the
  // last build gets a new file instead of a stale one.
  const hash = createHash("sha256")
    .update(segments.map((s) => `${s.key}:${s.size}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  const file = path.join(CACHE_DIR, `${safe(robotId)}__${safe(sessionId)}__${safe(camera)}__${hash}.mp4`);
  try {
    await stat(file);
    return file;
  } catch {
    // not built yet
  }
  let job = building.get(file);
  if (!job) {
    job = build(robotId, sessionId, segments, file).finally(() => building.delete(file));
    building.set(file, job);
  }
  return job;
}

async function build(
  robotId: string,
  sessionId: string,
  segments: Array<ArchiveFile & CameraSegment>,
  file: string,
): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  void sweep();
  const prefix = sessionPrefix(robotId, sessionId);
  const urls = await Promise.all(segments.map((s) => storage.signedUrl(prefix + s.name)));
  const list = `${file}.txt`;
  const part = `${file}.part`;
  // concat demuxer list; single quotes inside a URL are escaped the way ffmpeg expects
  await writeFile(list, urls.map((u) => `file '${u.replace(/'/g, "'\\''")}'`).join("\n") + "\n");

  try {
    const probe = await run(FFPROBE, [
      "-v", "error", ...NET, "-show_entries", "stream=codec_type,codec_name,pix_fmt",
      "-of", "json", urls[0],
    ]);
    const streams = (JSON.parse(probe || "{}").streams ?? []) as Array<{
      codec_type?: string;
      codec_name?: string;
      pix_fmt?: string;
    }>;
    const video = streams.find((s) => s.codec_type === "video");
    const hasAudio = streams.some((s) => s.codec_type === "audio");
    const eightBit420 = !video?.pix_fmt || video.pix_fmt === "yuv420p" || video.pix_fmt === "yuvj420p";

    let vcodec: string[];
    if (video?.codec_name === "h264" && eightBit420) vcodec = ["-c:v", "copy", "-tag:v", "avc1"];
    else if (video?.codec_name === "hevc" && eightBit420) vcodec = ["-c:v", "copy", "-tag:v", "hvc1"];
    else vcodec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-tag:v", "avc1"];

    await run(FFMPEG, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      ...NET, "-f", "concat", "-safe", "0", "-i", list,
      "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "128k"] : ["-an"]),
      ...vcodec,
      "-movflags", "+faststart", "-f", "mp4", part,
    ]);
    await rename(part, file);
    return file;
  } finally {
    await rm(list, { force: true });
    await rm(part, { force: true });
  }
}

/** Deletes cached MP4s older than CACHE_HOURS. Best effort: a failure only leaves files behind. */
async function sweep(): Promise<void> {
  try {
    const cutoff = Date.now() - CACHE_HOURS * 3600_000;
    for (const name of await readdir(CACHE_DIR)) {
      const p = path.join(CACHE_DIR, name);
      const s = await stat(p);
      if (s.mtimeMs < cutoff && !building.has(p.replace(/\.(part|txt)$/, ""))) await rm(p, { force: true });
    }
  } catch {
    // ignore
  }
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_");
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().slice(-500)}`)),
    );
  });
}

/** Download name for a camera MP4: ductrobot01_20260926_112634_session02_cam1.mp4 */
export function mp4Name(robotId: string, sessionId: string, camera: string): string {
  return `${safe(robotId)}_${safe(sessionId)}_${safe(camera)}.mp4`;
}

export const mp4Enabled = () => storage.mode === "s3" && Boolean(config.bucket);
