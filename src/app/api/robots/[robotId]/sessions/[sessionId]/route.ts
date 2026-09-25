import { NextResponse } from "next/server";
import { cameraSegments, getSession, listSessionFiles, withUrls } from "@/lib/archive";
import type { SessionDetail } from "@/lib/types";

// One session: summary, every file with a download URL, and each camera's segments for
// the player. 404 when the session has no files.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ robotId: string; sessionId: string }> },
) {
  const { robotId, sessionId } = await params;
  const session = await getSession(robotId, sessionId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const files = await listSessionFiles(robotId, sessionId);

  const cameras = session.cameras.map((name) => {
    const segs = cameraSegments(files, name, session.videoSegmentSec);
    return {
      name,
      segments: segs.map(({ start, duration }) => ({ start, duration })),
      bytes: files.filter((f) => f.camera === name).reduce((n, f) => n + f.size, 0),
      seconds: segs.reduce((n, s) => n + s.duration, 0),
    };
  });

  return NextResponse.json({
    session,
    files: withUrls(robotId, sessionId, files, true),
    cameras,
  } satisfies SessionDetail);
}
