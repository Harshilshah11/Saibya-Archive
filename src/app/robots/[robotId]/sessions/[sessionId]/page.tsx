import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cameraSegments, getSession, listSessionFiles, requestNow, storageMode, withUrls } from "@/lib/archive";
import { config } from "@/lib/config";
import { parseChunkTime, SESSION_FILE } from "@/lib/keys";
import { formatAgo, formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DownloadButton } from "@/components/DownloadButton";
import { FileList } from "@/components/FileList";
import { SessionPlayer } from "@/components/player/SessionPlayer";
import { Crumbs, Panel, Stat, StatusBadge, UploadBadge } from "@/components/ui";

type Props = {
  params: Promise<{ robotId: string; sessionId: string }>;
  searchParams: Promise<{ t?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { robotId, sessionId } = await params;
  return { title: `${decodeURIComponent(sessionId)} · ${decodeURIComponent(robotId)}` };
}

export default async function SessionPage({ params, searchParams }: Props) {
  const p = await params;
  const robotId = decodeURIComponent(p.robotId);
  const sessionId = decodeURIComponent(p.sessionId);
  const { t } = await searchParams;

  const session = await getSession(robotId, sessionId);
  if (!session) notFound();
  const files = await listSessionFiles(robotId, sessionId);
  const signed = withUrls(robotId, sessionId, files, true);

  const apiBase = `/api/robots/${encodeURIComponent(robotId)}/sessions/${encodeURIComponent(sessionId)}`;
  const base = `${robotId}_${sessionId}`;
  const cameras = session.cameras.map((name) => {
    const segs = cameraSegments(files, name, session.videoSegmentSec);
    const all = files.filter((f) => f.camera === name);
    return {
      name,
      segments: segs.map(({ start, duration }) => ({ start, duration })),
      bytes: all.reduce((n, f) => n + f.size, 0),
      seconds: segs.reduce((n, s) => n + s.duration, 0),
    };
  });
  // DVR segments may start before and end after the session, so the timeline covers both
  const segStarts = cameras.flatMap((c) => c.segments.map((s) => s.start));
  const segEnds = cameras.flatMap((c) => c.segments.map((s) => s.start + s.duration * 1000));
  const start = Math.min(session.start ?? requestNow(), ...segStarts);
  const end = Math.max(session.end ?? start, start + 1000, ...segEnds);
  const sessionFile = signed.find((f) => f.name === SESSION_FILE);
  const imuBytes = files.filter((f) => f.sensor === "imu").reduce((n, f) => n + f.size, 0);
  const lidarBytes = files.filter((f) => f.sensor === "lidar").reduce((n, f) => n + f.size, 0);

  return (
    <div className="space-y-5">
      <div>
        <Crumbs
          items={[
            { href: "/", label: "Robots" },
            { href: `/robots/${encodeURIComponent(robotId)}`, label: robotId },
            { label: sessionId },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{sessionId}</h1>
          <StatusBadge status={session.status} />
          <UploadBadge status={session.status} upload={session.upload} />
          {session.simulated && (
            <span className="rounded-full border border-warn/50 px-2 py-0.5 text-xs font-medium text-warn">
              Simulated data
            </span>
          )}
          {session.status === "active" && <AutoRefresh />}
          <div className="ml-auto">
            <DownloadButton
              apiBase={apiBase}
              fileName={`${base}.zip`}
              totalBytes={session.totalBytes}
              what={{ type: "session" }}
              label="Download session (ZIP)"
              variant="primary"
            />
          </div>
        </div>
        {session.status === "active" && (
          <p className="mt-2 rounded-md bg-live-soft px-3 py-2 text-sm text-live">
            Still recording. Downloads include everything uploaded so far.
          </p>
        )}
        {session.status === "interrupted" && (
          <p className="mt-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
            session.json was never marked as ended and nothing was uploaded for over {config.interruptedAfterMin} minutes. The robot probably lost
            power or network. Everything uploaded is still playable and downloadable.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Started" value={<span className="text-base">{formatDateTime(session.start)}</span>} />
        <Stat label="Duration" value={formatDuration(session.durationSec)} />
        <Stat label="Camera video" value={formatBytes(session.stats.camera.bytes)} hint={`${session.cameras.length} cameras`} />
        <Stat label="LiDAR + IMU" value={formatBytes(session.stats.sensors.bytes)} />
        <Stat label="Last upload" value={formatAgo(session.lastUpload)} />
      </div>

      <SessionPlayer apiBase={apiBase} start={start} end={end} demo={storageMode() === "demo"}
        cameras={cameras}
        initialTime={t ? parseChunkTime(t) : undefined}
      />

      <Panel title="Downloads" actions={<span className="text-xs text-muted">one file per stream</span>}>
        <ul className="divide-y divide-border">
          {cameras.map((c) => (
            <DownloadRow
              key={c.name}
              title={`${c.name} video`}
              detail={`${formatDuration(c.seconds)} · MPEG-TS, plays in VLC / Media Player`}
              button={
                <DownloadButton
                  apiBase={apiBase}
                  fileName={`${base}_${c.name}.ts`}
                  totalBytes={c.bytes}
                  what={{ type: "camera", camera: c.name }}
                  label="Download .ts"
                />
              }
            />
          ))}
          {session.hasImu && (
            <DownloadRow
              title="IMU"
              detail="HWT905 samples in one CSV: t_unix, ax, ay, az, gx, gy, gz, mx, my, mz, roll, pitch, yaw, yaw_raw"
              button={
                <DownloadButton
                  apiBase={apiBase}
                  fileName={`${base}_imu.csv`}
                  totalBytes={imuBytes}
                  what={{ type: "imu" }}
                  label="Download .csv"
                />
              }
            />
          )}
          {session.hasLidar && (
            <DownloadRow
              title="LiDAR"
              detail="RPLIDAR C1 scans as numpy .npz chunks (t, offsets, points[angle_deg, range_m, quality]). Load with numpy.load."
              button={
                <DownloadButton
                  apiBase={apiBase}
                  fileName={`${base}_lidar.npz`}
                  totalBytes={lidarBytes}
                  what={{ type: "lidar" }}
                  label="Download .zip"
                />
              }
            />
          )}
          {sessionFile && (
            <DownloadRow
              title="session.json"
              detail="Session summary"
              button={
                <a
                  href={sessionFile.url}
                  className="whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
                >
                  Download .json
                </a>
              }
            />
          )}
        </ul>
      </Panel>

      <details className="group overflow-hidden rounded-xl border border-border bg-panel shadow-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm text-muted hover:text-text">
          <span className="transition-transform group-open:rotate-90">▸</span>
          Raw upload chunks and session.json
          <span className="ml-auto text-xs text-faint">{files.length} objects in S3</span>
        </summary>
        <div className="grid gap-3 border-t border-border p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="rounded-md border border-border">
            <FileList files={signed} />
          </div>
          <pre className="max-h-96 overflow-auto rounded-md border border-border p-3 font-mono text-xs leading-relaxed text-muted">
            {session.manifest ? JSON.stringify(session.manifest, null, 2) : "No session.json uploaded yet."}
          </pre>
        </div>
      </details>
    </div>
  );
}

function DownloadRow({ title, detail, button }: { title: string; detail: string; button: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{detail}</div>
      </div>
      {button}
    </li>
  );
}
