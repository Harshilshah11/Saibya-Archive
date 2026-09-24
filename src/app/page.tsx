import Link from "next/link";
import { listRobots, requestNow } from "@/lib/archive";
import { formatAgo, formatBytes } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SessionTable } from "@/components/SessionTable";
import { EmptyState, Panel, Stat } from "@/components/ui";

export default async function Home() {
  const robots = await listRobots();
  const sessions = robots.flatMap((r) => r.sessions).sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
  const totalBytes = robots.reduce((n, r) => n + r.totalBytes, 0);
  const recording = sessions.filter((s) => s.status === "active").length;
  const hours = sessions.reduce((n, s) => n + (s.durationSec ?? 0), 0) / 3600;
  const now = requestNow();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Robots</h1>
          {recording > 0 && <AutoRefresh />}
        </div>
        <p className="text-sm text-muted">
          Sessions uploaded by each robot. Open one to watch the cameras or download the video and LiDAR + IMU data.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Robots" value={robots.length} />
        <Stat label="Sessions" value={sessions.length} hint={`${hours.toFixed(1)} h recorded`} />
        <Stat label="Recording now" value={recording} />
        <Stat label="Archive size" value={formatBytes(totalBytes)} />
      </div>

      {robots.length === 0 ? (
        <EmptyState title="No robots found">
          The bucket is empty. Sessions show up here once cloud_sync starts uploading.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {robots.map((r) => {
            const latest = r.sessions[0];
            return (
              <Link
                key={r.robotId}
                href={`/robots/${encodeURIComponent(r.robotId)}`}
                className="group rounded-lg border border-border bg-panel p-4 transition-colors hover:border-accent"
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-lg font-semibold group-hover:text-accent">{r.robotId}</div>
                  {r.activeSessions > 0 ? (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-live">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-live" /> Recording
                    </span>
                  ) : (
                    <span className="text-xs text-faint">Idle</span>
                  )}
                </div>
                <dl className="tabular mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Sessions</dt>
                    <dd className="font-medium">{r.sessions.length}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Size</dt>
                    <dd className="font-medium">{formatBytes(r.totalBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Last upload</dt>
                    <dd className="font-medium">{formatAgo(r.lastUpload, now)}</dd>
                  </div>
                </dl>
                {latest && (
                  <div className="mt-3 truncate border-t border-border pt-2 text-xs text-muted">
                    Latest: <span className="font-mono">{latest.sessionId}</span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {sessions.length > 0 && (
        <Panel
          title="Recent sessions"
          actions={
            <Link href="/data" className="text-xs text-accent hover:underline">
              Browse by data type →
            </Link>
          }
        >
          <SessionTable sessions={sessions.slice(0, 10)} showRobot />
        </Panel>
      )}
    </div>
  );
}
