import { gzipSync } from "node:zlib";
import { NextResponse, type NextRequest } from "next/server";
import { config, demoMode } from "@/lib/config";
import { parseChunkTime } from "@/lib/keys";
import { demoText } from "@/lib/storage/demo";

// Stands in for presigned S3 URLs in demo mode.
export async function GET(req: NextRequest) {
  if (!demoMode) return new NextResponse("Not found", { status: 404 });
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const download = req.nextUrl.searchParams.get("download");
  const headers: Record<string, string> = { "Cache-Control": "private, max-age=3600" };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/"/g, "")}"`;

  const text = demoText(key);
  if (text !== null) return new NextResponse(text, { headers: { ...headers, "Content-Type": "application/json" } });

  const imu = /\/sensors\/imu\/([^/]+)\.csv\.gz$/.exec(key);
  const start = imu ? parseChunkTime(imu[1], config.robotUtcOffsetMin) : undefined;
  if (start !== undefined) {
    return new NextResponse(demoImuCsv(start) as BodyInit, {
      headers: { ...headers, "Content-Type": "application/octet-stream" },
    });
  }

  // Video and LiDAR chunks are listed in the demo archive but have no content.
  return new NextResponse("Demo mode has no content for this file", { status: 404 });
}

/** One chunk of 50 Hz IMU samples in the robot's CSV format, gzipped. */
function demoImuCsv(startMs: number): Uint8Array {
  const r = (n: number, d = 3) => n.toFixed(d);
  const rows = ["t_unix,ax,ay,az,gx,gy,gz,mx,my,mz,roll,pitch,yaw,yaw_raw"];
  for (let i = 0; i < config.chunkSec * 50; i++) {
    const t = startMs / 1000 + i / 50;
    const yaw = ((t * 6) % 360) - 180;
    rows.push(
      [
        r(t),
        r(0.2 * Math.sin(t)), r(0.1 * Math.cos(t)), r(9.81 + 0.02 * Math.sin(7 * t)),
        r(0.3 * Math.sin(3 * t), 2), r(0.3 * Math.cos(3 * t), 2), r(6, 2),
        r(30 * Math.cos(t / 10), 1), r(30 * Math.sin(t / 10), 1), r(-40, 1),
        r(0.5 * Math.sin(t), 2), r(0.5 * Math.cos(t), 2), r(yaw, 2), r(yaw, 2),
      ].join(","),
    );
  }
  return new Uint8Array(gzipSync(rows.join("\n") + "\n"));
}
