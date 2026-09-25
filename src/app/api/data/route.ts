import { NextResponse } from "next/server";
import { listRobots, listSessionFiles } from "@/lib/archive";
import { sortCameras } from "@/lib/keys";
import type { DataIndex, DataRow } from "@/lib/types";

// Every session's per-stream sizes, for the web app's /data page (searching, filtering and
// sorting happen in the browser).
export async function GET() {
  const robots = await listRobots();
  const rows: DataRow[] = await Promise.all(
    robots
      .flatMap((r) => r.sessions)
      .map(async (s) => {
        const files = await listSessionFiles(s.robotId, s.sessionId);
        const size = (pick: (f: (typeof files)[number]) => boolean) => files.filter(pick).reduce((n, f) => n + f.size, 0);
        const cams = sortCameras(new Set(files.flatMap((f) => (f.kind === "camera" && f.camera ? [f.camera] : []))));
        return {
          robotId: s.robotId,
          sessionId: s.sessionId,
          trip: s.trip,
          start: s.start,
          durationSec: s.durationSec,
          status: s.status,
          upload: s.upload,
          simulated: s.simulated,
          cameras: cams.map((camera) => ({ camera, bytes: size((f) => f.kind === "camera" && f.camera === camera) })),
          imuBytes: size((f) => f.kind === "sensors" && f.sensor === "imu"),
          lidarBytes: size((f) => f.kind === "sensors" && f.sensor === "lidar"),
          totalBytes: size(() => true),
        };
      }),
  );
  return NextResponse.json({ robots: robots.map((r) => r.robotId), rows } satisfies DataIndex);
}
