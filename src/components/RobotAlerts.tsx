import { formatAgo, formatBytes } from "@/lib/format";
import type { RobotLinkInfo } from "@/lib/types";

// The robot's own view of its upload health, from cloud_sync's heartbeat (POST
// /api/ingest/heartbeat, about once a minute): backlog waiting on the robot and its alerts,
// e.g. CLOUD_SYNC_BACKLOG_FULL well before the 20 GB cap starts dropping the oldest files.

type Alert = { code?: string; severity?: string; message?: string };

/** A heartbeat older than this is shown as "no heartbeat", not as the robot's current state. */
const STALE_MS = 5 * 60_000;

const isStale = (seenAt: number) => Date.now() - seenAt > STALE_MS;

export function RobotAlerts({ link }: { link: RobotLinkInfo | null }) {
  if (!link) return null;
  const status = link.status;
  const alerts = (Array.isArray(status.alerts) ? status.alerts : []) as Alert[];
  const pendingFiles = Number(status.pending_files) || 0;
  const pendingBytes = Number(status.pending_bytes) || 0;

  if (isStale(link.seenAt)) {
    return (
      <p className="text-sm text-muted">
        Last heartbeat from the robot {formatAgo(link.seenAt)}: it is off, offline, or not sending. Its uploads wait
        on the robot until it is back.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Robot link: heartbeat {formatAgo(link.seenAt)}
        {pendingFiles > 0
          ? `, ${pendingFiles} file${pendingFiles === 1 ? "" : "s"} (${formatBytes(pendingBytes)}) waiting to upload`
          : ", nothing waiting to upload"}
      </p>
      {alerts.map((a, i) => {
        const critical = a.severity === "critical";
        return (
          <div
            key={`${a.code}-${i}`}
            role="alert"
            className={`rounded-lg border px-3 py-2 text-sm ${
              critical ? "border-live bg-live-soft text-live" : "border-warn bg-warn-soft text-warn"
            }`}
          >
            <span className="font-mono text-xs font-semibold">{a.code}</span>
            <span className="ml-2 text-text">{a.message}</span>
          </div>
        );
      })}
    </div>
  );
}
