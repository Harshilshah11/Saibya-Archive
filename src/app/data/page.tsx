import type { Metadata } from "next";
import { listRobots, listSessionFiles } from "@/lib/archive";
import { sortCameras } from "@/lib/keys";
import { parseFilters } from "@/lib/dataFilters";
import { DataBrowser, type DataRow } from "@/components/DataBrowser";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Data" };

export default async function DataPage({ searchParams }: PageProps<"/data">) {
  const initial = parseFilters(await searchParams);
  const robots = await listRobots();

  // Every session's per-stream sizes; searching, filtering and sorting happen in the browser.
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

  return (
    <div className="space-y-5">
      <PageHeader title="Data" description="Find sessions across every robot and download them by data type." />
      <DataBrowser rows={rows} robots={robots.map((r) => r.robotId)} initial={initial} />
    </div>
  );
}
