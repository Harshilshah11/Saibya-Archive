import type { Metadata } from "next";
import Link from "next/link";
import { listRobots, listSessionFiles } from "@/lib/archive";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { sortCameras } from "@/lib/keys";
import type { DataType } from "@/lib/types";
import { DownloadButton } from "@/components/DownloadButton";
import { sessionHref } from "@/components/SessionTable";
import { EmptyState, Panel, Pill, Stat, StatusBadge } from "@/components/ui";

export const metadata: Metadata = { title: "Data" };

type Props = { searchParams: Promise<{ type?: string; robot?: string; cam?: string }> };

const TYPES: Array<{ value: DataType; label: string; blurb: string }> = [
  { value: "camera", label: "Camera", blurb: "One video per camera per session (main stream 101, .ts)" },
  { value: "sensors", label: "LiDAR + IMU", blurb: "HWT905 IMU as one .csv and RPLIDAR C1 scans as a .zip of .npz, per session" },
];

export default async function DataPage({ searchParams }: Props) {
  const q = await searchParams;
  const type: DataType = q.type === "sensors" ? "sensors" : "camera";
  const robots = await listRobots();
  const robot = robots.some((r) => r.robotId === q.robot) ? q.robot : undefined;
  const cam = type === "camera" && q.cam && /^[\w.-]+$/.test(q.cam) ? q.cam : undefined;

  const href = (next: Partial<{ type: string; robot: string; cam: string }>) => {
    const p = new URLSearchParams();
    const merged = { type, robot, cam, ...next };
    if (merged.type) p.set("type", merged.type);
    if (merged.robot) p.set("robot", merged.robot);
    if (merged.cam && merged.type === "camera") p.set("cam", merged.cam);
    return `/data?${p}`;
  };

  const sessions = robots.filter((r) => !robot || r.robotId === robot).flatMap((r) => r.sessions);
  const rows = (
    await Promise.all(
      sessions.map(async (s) => {
        const files = await listSessionFiles(s.robotId, s.sessionId);
        const picked = files.filter((f) =>
          type === "camera" ? f.kind === "camera" && (!cam || f.camera === cam) : f.kind === "sensors",
        );
        const perCamera = sortCameras(new Set(picked.flatMap((f) => (f.camera ? [f.camera] : [])))).map((c) => ({
          camera: c,
          bytes: picked.filter((f) => f.camera === c).reduce((n, f) => n + f.size, 0),
        }));
        const sensorBytes = (k: "imu" | "lidar") => picked.filter((f) => f.sensor === k).reduce((n, f) => n + f.size, 0);
        return {
          session: s,
          bytes: picked.reduce((n, f) => n + f.size, 0),
          perCamera,
          imuBytes: sensorBytes("imu"),
          lidarBytes: sensorBytes("lidar"),
        };
      }),
    )
  )
    .filter((r) => r.bytes > 0)
    .sort((a, b) => (b.session.start ?? 0) - (a.session.start ?? 0));

  const allCams = sortCameras(new Set(sessions.flatMap((s) => s.cameras)));
  const totals: Record<DataType, number> = {
    camera: sessions.reduce((n, s) => n + s.stats.camera.bytes, 0),
    sensors: sessions.reduce((n, s) => n + s.stats.sensors.bytes, 0),
  };
  const current = TYPES.find((t) => t.value === type)!;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data</h1>
        <p className="text-sm text-muted">Download by data type, across every robot and session.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {TYPES.map((t) => (
          <Link
            key={t.value}
            href={href({ type: t.value, cam: undefined })}
            className={`rounded-lg border bg-panel px-4 py-3 transition-colors ${
              t.value === type ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{t.label}</span>
              <span className="tabular text-sm text-muted">{formatBytes(totals[t.value])}</span>
            </div>
            <div className="mt-1 text-xs text-muted">{t.blurb}</div>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Robot</span>
        <Pill active={!robot} href={href({ robot: undefined })}>All</Pill>
        {robots.map((r) => (
          <Pill key={r.robotId} active={robot === r.robotId} href={href({ robot: r.robotId })}>
            <span className="font-mono">{r.robotId}</span>
          </Pill>
        ))}
        {type === "camera" && allCams.length > 0 && (
          <>
            <span className="ml-4 text-xs text-muted">Camera</span>
            <Pill active={!cam} href={href({ cam: undefined })}>All</Pill>
            {allCams.map((c) => (
              <Pill key={c} active={cam === c} href={href({ cam: c })}>
                <span className="font-mono">{c}</span>
              </Pill>
            ))}
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Sessions" value={rows.length} />
        <Stat label="Recorded" value={formatDuration(rows.reduce((n, r) => n + (r.session.durationSec ?? 0), 0))} />
        <Stat label="Size" value={formatBytes(rows.reduce((n, r) => n + r.bytes, 0))} />
      </div>

      <Panel title={`${current.label} by session`}>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title={`No ${current.label} data for this filter`} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Robot</th>
                  <th className="px-4 py-2 font-medium">Session</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Download</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {rows.map(({ session: s, perCamera, imuBytes, lidarBytes }) => {
                  const apiBase = `/api/robots/${encodeURIComponent(s.robotId)}/sessions/${encodeURIComponent(s.sessionId)}`;
                  const base = `${s.robotId}_${s.sessionId}`;
                  return (
                    <tr key={`${s.robotId}/${s.sessionId}`} className="border-b border-border last:border-0 hover:bg-panel-2">
                      <td className="px-4 py-2.5 font-mono">{s.robotId}</td>
                      <td className="px-4 py-2.5">
                        <Link href={sessionHref(s)} className="font-mono text-accent hover:underline">
                          {s.sessionId}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(s.start)}</td>
                      <td className="px-4 py-2.5">{formatDuration(s.durationSec)}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {type === "camera" ? (
                            perCamera.map((c) => (
                              <DownloadButton
                                key={c.camera}
                                apiBase={apiBase}
                                fileName={`${base}_${c.camera}.ts`}
                                totalBytes={c.bytes}
                                what={{ type: "camera", camera: c.camera }}
                                label={c.camera}
                              />
                            ))
                          ) : (
                            <>
                              {imuBytes > 0 && (
                                <DownloadButton
                                  apiBase={apiBase}
                                  fileName={`${base}_imu.csv`}
                                  totalBytes={imuBytes}
                                  what={{ type: "imu" }}
                                  label="IMU .csv"
                                />
                              )}
                              {lidarBytes > 0 && (
                                <DownloadButton
                                  apiBase={apiBase}
                                  fileName={`${base}_lidar.zip`}
                                  totalBytes={lidarBytes}
                                  what={{ type: "lidar" }}
                                  label="LiDAR .zip"
                                />
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
