import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { cameraSegments, getSession, listSessionFiles } from "@/lib/archive";
import { cameraMp4, mp4Enabled, mp4Name } from "@/lib/mp4";

// One camera of a session as a single MP4 (see lib/mp4.ts for why it plays on a Mac).
// The first request builds it from the .ts chunks and caches it on the Server; later ones
// stream the cached file. Range is honoured, which Safari and QuickTime need to play and seek.
// ?download=1 saves it as <robot>_<session>_<camera>.mp4.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ robotId: string; sessionId: string; camera: string }> },
) {
  const { robotId, sessionId, camera } = await params;
  if (!mp4Enabled()) return new NextResponse("MP4 export needs S3 (not available in demo mode)", { status: 501 });

  const session = await getSession(robotId, sessionId);
  if (!session) return new NextResponse("Session not found", { status: 404 });
  const segments = cameraSegments(await listSessionFiles(robotId, sessionId), camera, session.videoSegmentSec);
  if (!segments.length) return new NextResponse("No video for this camera", { status: 404 });

  let file: string;
  try {
    file = await cameraMp4(robotId, sessionId, camera, segments);
  } catch (err) {
    console.error(`mp4 ${robotId}/${sessionId}/${camera}:`, err);
    return new NextResponse("Could not build the MP4 from this camera's video", { status: 502 });
  }

  const size = (await stat(file)).size;
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `${req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${mp4Name(robotId, sessionId, camera)}"`,
  });

  // Single byte range only ("bytes=a-b", "bytes=a-", "bytes=-n"), which is all players send.
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new NextResponse("Range not satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new NextResponse(body, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers });
}
