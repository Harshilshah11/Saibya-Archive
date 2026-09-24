import { NextResponse, type NextRequest } from "next/server";
import { listSessionFiles, withUrls } from "@/lib/archive";
import type { FileKind } from "@/lib/types";

// Session file list with download URLs (see fileUrl). Used by the data browser and the
// in-browser downloads.
//   ?kind=camera|sensors|meta   filter
//   ?camera=cam2                filter camera chunks
//   ?sensor=lidar|imu           filter sensor chunks
//   ?download=1                 URLs force a file download
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ robotId: string; sessionId: string }> },
) {
  const { robotId, sessionId } = await params;
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") as FileKind | null;
  const camera = q.get("camera");
  const sensor = q.get("sensor");

  let files = await listSessionFiles(robotId, sessionId);
  if (!files.length) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (kind) files = files.filter((f) => f.kind === kind);
  if (camera) files = files.filter((f) => f.camera === camera);
  if (sensor) files = files.filter((f) => f.sensor === sensor);

  return NextResponse.json({ files: withUrls(robotId, sessionId, files, q.get("download") === "1") });
}
