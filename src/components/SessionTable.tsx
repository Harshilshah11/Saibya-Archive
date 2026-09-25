import Link from "next/link";
import { requestNow } from "@/lib/api";
import { formatAgo, formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import type { SessionSummary } from "@/lib/types";
import { StatusBadge, UploadBadge } from "./ui";

export function sessionHref(s: Pick<SessionSummary, "robotId" | "sessionId">) {
  return `/robots/${encodeURIComponent(s.robotId)}/sessions/${encodeURIComponent(s.sessionId)}`;
}

export function SessionTable({ sessions, showRobot = false }: { sessions: SessionSummary[]; showRobot?: boolean }) {
  const now = requestNow();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-panel-2/60 text-left whitespace-nowrap text-[11px] uppercase tracking-wide text-muted">
            {showRobot && <th className="px-4 py-2 font-medium">Robot</th>}
            <th className="px-4 py-2 font-medium">Session</th>
            <th className="px-4 py-2 font-medium">Trip</th>
            <th className="px-4 py-2 font-medium">Started</th>
            <th className="px-4 py-2 font-medium">Duration</th>
            <th className="px-4 py-2 font-medium">Data</th>
            <th className="px-4 py-2 text-right font-medium">Size</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Last upload</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {sessions.map((s) => (
            <tr key={`${s.robotId}/${s.sessionId}`} className="border-b border-border last:border-0 hover:bg-panel-2">
              {showRobot && (
                <td className="px-4 py-2.5">
                  <Link href={`/robots/${encodeURIComponent(s.robotId)}`} className="whitespace-nowrap font-mono font-medium hover:text-accent">
                    {s.robotId}
                  </Link>
                </td>
              )}
              <td className="px-4 py-2.5">
                <Link href={sessionHref(s)} className="font-mono text-accent hover:underline">
                  {s.sessionId}
                </Link>
              </td>
              <td className="min-w-32 px-4 py-2.5 text-muted">{s.trip ?? "—"}</td>
              <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(s.start)}</td>
              <td className="whitespace-nowrap px-4 py-2.5">{formatDuration(s.durationSec)}</td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap gap-1 text-xs">
                  <Tag on={s.cameras.length > 0}>{s.cameras.length} cam</Tag>
                  <Tag on={s.hasLidar}>LiDAR</Tag>
                  <Tag on={s.hasImu}>IMU</Tag>
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">{formatBytes(s.totalBytes)}</td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap gap-1">
                  <StatusBadge status={s.status} />
                  <UploadBadge status={s.status} upload={s.upload} />
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatAgo(s.lastUpload, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 ${on ? "border border-border bg-panel-2 text-text" : "text-faint line-through"}`}>{children}</span>
  );
}
