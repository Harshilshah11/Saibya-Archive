import { NextResponse } from "next/server";
import { cameraSegments, fileUrl, listSessionFiles } from "@/lib/archive";

// HLS VOD playlist over the 1-minute .ts chunks of one camera. Each segment URL
// redirects to a freshly presigned S3 URL, so the video comes straight from S3 and
// long viewing sessions never hit an expired link.
// Every chunk starts with EXT-X-DISCONTINUITY: ffmpeg's segmenter may reset
// timestamps per file, and this keeps hls.js from mis-placing segments.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ robotId: string; sessionId: string; camera: string }> },
) {
  const { robotId, sessionId, camera } = await params;
  const segments = cameraSegments(await listSessionFiles(robotId, sessionId), camera);
  if (!segments.length) return new NextResponse("No video for this camera", { status: 404 });

  const target = Math.ceil(Math.max(...segments.map((s) => s.duration)));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${target}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
  ];
  segments.forEach((s, i) => {
    if (i > 0) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(s.start).toISOString()}`);
    lines.push(`#EXTINF:${s.duration.toFixed(3)},`);
    lines.push(fileUrl(robotId, sessionId, s.name));
  });
  lines.push("#EXT-X-ENDLIST", "");

  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
  });
}
