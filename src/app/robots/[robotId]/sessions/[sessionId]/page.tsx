import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInfo, getSession, requestNow } from "@/lib/api";
import { parseChunkTime, SESSION_FILE } from "@/lib/keys";
import { formatAgo, formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DownloadButton } from "@/components/DownloadButton";
import { FileList } from "@/components/FileList";
import { SessionPlayer } from "@/components/player/SessionPlayer";
import { Crumbs, Panel, StatusBadge, UploadBadge } from "@/components/ui";

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

  const [detail, info] = await Promise.all([getSession(robotId, sessionId), getInfo()]);
  if (!detail) notFound();
  // files carry download URLs (?download=1); cameras carry the player's segments
  const { session, files, cameras } = detail;

  const apiBase = `/api/robots/${encodeURIComponent(robotId)}/sessions/${encodeURIComponent(sessionId)}`;
  const base = `${robotId}_${sessionId}`;
  // DVR segments may start before and end after the session, so the timeline covers both
  const segStarts = cameras.flatMap((c) => c.segments.map((s) => s.start));
  const segEnds = cameras.flatMap((c) => c.segments.map((s) => s.start + s.duration * 1000));
  const start = Math.min(session.start ?? requestNow(), ...segStarts);
  const end = Math.max(session.end ?? start, start + 1000, ...segEnds);
  const sessionFile = files.find((f) => f.name === SESSION_FILE);
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
            session.json was never marked as ended and nothing was uploaded for over {info?.interruptedAfterMin ?? 30} minutes. The robot probably lost
            power or network. Everything uploaded is still playable and downloadable.
          </p>
        )}
      </div>

      <SessionPlayer apiBase={apiBase} start={start} end={end} demo={info?.mode === "demo"}
        cameras={cameras}
        initialTime={t ? parseChunkTime(t) : undefined}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Panel title="Session">
          <dl className="tabular divide-y divide-border text-sm">
            <Fact label="Started">{formatDateTime(session.start)}</Fact>
            <Fact label="Duration">{formatDuration(session.durationSec)}</Fact>
            <Fact label="Camera video">
              {formatBytes(session.stats.camera.bytes)}
              <span className="text-muted"> · {session.cameras.length} camera{session.cameras.length === 1 ? "" : "s"}</span>
            </Fact>
            <Fact label="LiDAR + IMU">{formatBytes(session.stats.sensors.bytes)}</Fact>
            <Fact label="Last upload">{formatAgo(session.lastUpload)}</Fact>
          </dl>
        </Panel>

        <Panel title="Downloads" actions={<span className="text-xs text-muted">one file per stream</span>}>
          <ul className="grid divide-y divide-border md:grid-cols-2 md:divide-y-0 md:[&>li]:border-b md:[&>li]:border-border md:[&>li:nth-child(odd)]:border-r">
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
      </div>

      <details className="group overflow-hidden rounded-xl border border-border bg-panel shadow-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm text-muted hover:text-text">
          <span className="transition-transform group-open:rotate-90">▸</span>
          Raw upload chunks and session.json
          <span className="ml-auto text-xs text-faint">{files.length} objects in S3</span>
        </summary>
        <div className="grid gap-3 border-t border-border p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="rounded-md border border-border">
            <FileList files={files} />
          </div>
          <pre className="max-h-96 overflow-auto rounded-md border border-border p-3 font-mono text-xs leading-relaxed text-muted">
            {session.manifest ? JSON.stringify(session.manifest, null, 2) : "No session.json uploaded yet."}
          </pre>
        </div>
      </details>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function DownloadRow({ title, detail, button }: { title: string; detail: string; button: React.ReactNode }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate font-mono text-sm font-medium">{title}</div>
        {button}
      </div>
      <div className="mt-1 text-xs text-muted">{detail}</div>
    </li>
  );
}
