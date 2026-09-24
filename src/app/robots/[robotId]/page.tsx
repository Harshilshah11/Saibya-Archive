import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listRobotIds, listSessions } from "@/lib/archive";
import { formatAgo, formatBytes } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import type { SessionStatus } from "@/lib/types";
import { SessionTable } from "@/components/SessionTable";
import { Crumbs, EmptyState, Panel, Pill, Stat } from "@/components/ui";

type Props = {
  params: Promise<{ robotId: string }>;
  searchParams: Promise<{ status?: string; q?: string; date?: string; page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: decodeURIComponent((await params).robotId) };
}

const PAGE_SIZE = 50;

const FILTERS: Array<{ value?: SessionStatus; label: string }> = [
  { label: "All" },
  { value: "active", label: "Recording" },
  { value: "closed", label: "Closed" },
  { value: "interrupted", label: "Interrupted" },
];

export default async function RobotPage({ params, searchParams }: Props) {
  const robotId = decodeURIComponent((await params).robotId);
  const sp = await searchParams;
  const status = FILTERS.some((f) => f.value === sp.status) ? sp.status : undefined;
  const q = sp.q?.trim().toLowerCase() || undefined;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined;
  if (!(await listRobotIds()).includes(robotId)) notFound();

  const all = await listSessions(robotId);
  const base = `/robots/${encodeURIComponent(robotId)}`;
  // search and date narrow the list first; the status pills count within that
  const searched = all.filter(
    (s) =>
      (!q || s.sessionId.toLowerCase().includes(q)) &&
      (!date || (s.start !== null && new Date(s.start).toISOString().startsWith(date))),
  );
  const filtered = status ? searched.filter((s) => s.status === status) : searched;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const sessions = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const link = (next: { status?: string; page?: number }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", sp.q!.trim());
    if (date) p.set("date", date);
    const st = "status" in next ? next.status : status;
    if (st) p.set("status", st);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const bytes = (k: "camera" | "sensors") => all.reduce((n, s) => n + s.stats[k].bytes, 0);
  const hours = all.reduce((n, s) => n + (s.durationSec ?? 0), 0) / 3600;
  const lastUpload = all.reduce<number | null>((m, s) => (s.lastUpload === null ? m : Math.max(m ?? 0, s.lastUpload)), null);

  return (
    <div className="space-y-6">
      <div>
        <Crumbs items={[{ href: "/", label: "Robots" }, { label: robotId }]} />
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{robotId}</h1>
          {all.some((s) => s.status === "active") && <AutoRefresh />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sessions" value={all.length} hint={`${hours.toFixed(1)} h recorded`} />
        <Stat label="Camera video" value={formatBytes(bytes("camera"))} />
        <Stat label="LiDAR + IMU" value={formatBytes(bytes("sensors"))} />
        <Stat label="Last upload" value={formatAgo(lastUpload)} />
      </div>

      <Panel
        title="Sessions"
        actions={
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Pill key={f.label} active={status === f.value} href={link({ status: f.value })}>
                {f.label}{" "}
                <span className="text-faint">
                  {f.value ? searched.filter((s) => s.status === f.value).length : searched.length}
                </span>
              </Pill>
            ))}
          </div>
        }
      >
        <form action={base} className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search session id"
            className="w-56 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-sm outline-none focus:border-accent"
          />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Day (UTC)
            <input
              type="date"
              name="date"
              defaultValue={date ?? ""}
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
            />
          </label>
          <button type="submit" className="rounded-md border border-border px-3 py-1.5 hover:border-accent hover:text-accent">
            Filter
          </button>
          {(q || date) && (
            <a href={link({ status })} className="text-xs text-muted hover:text-text">
              Clear
            </a>
          )}
        </form>
        {sessions.length ? (
          <>
            <SessionTable sessions={sessions} />
            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm">
                <span className="tabular text-xs text-muted">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link href={link({ page: page - 1 })} className="rounded-md border border-border px-3 py-1 hover:border-accent">
                      ← Newer
                    </Link>
                  )}
                  {page < pages && (
                    <Link href={link({ page: page + 1 })} className="rounded-md border border-border px-3 py-1 hover:border-accent">
                      Older →
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-4">
            <EmptyState title="No sessions match this filter" />
          </div>
        )}
      </Panel>
    </div>
  );
}
