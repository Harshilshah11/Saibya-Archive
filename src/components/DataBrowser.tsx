"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, formatClock, formatDateTime, formatDuration } from "@/lib/format";
import { DEFAULT_FILTERS as DEFAULTS, type DataView, type Filters } from "@/lib/dataFilters";
import type { DataRow } from "@/lib/types";
import { DownloadButton } from "./DownloadButton";
import { StatusBadge, UploadBadge } from "./ui";

const TYPES: Array<{ value: DataView; label: string; blurb: string }> = [
  { value: "all", label: "All data", blurb: "Whole session as one .zip · every camera, IMU, LiDAR, session.json" },
  { value: "camera", label: "Camera video", blurb: "One .ts per camera per session · main stream 101" },
  { value: "sensors", label: "LiDAR + IMU", blurb: "IMU as .csv · RPLIDAR scans as .zip of .npz" },
];

function dayKey(ms: number | null) {
  return ms === null ? "Unknown date" : new Date(ms).toISOString().slice(0, 10);
}

function dayLabel(key: string) {
  if (key === "Unknown date") return key;
  const d = new Date(`${key}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function DataBrowser({ rows, robots, initial }: { rows: DataRow[]; robots: string[]; initial: Filters }) {
  const [f, setF] = useState<Filters>(initial);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v && v !== DEFAULTS[k as keyof Filters]) p.set(k, v);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [f]);

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const allCams = useMemo(
    () => [...new Set(rows.flatMap((r) => r.cameras.map((c) => c.camera)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [rows],
  );

  const bytesOf = (r: DataRow, type: DataView) =>
    type === "all"
      ? r.totalBytes
      : type === "camera"
        ? r.cameras.filter((c) => !f.cam || c.camera === f.cam).reduce((n, c) => n + c.bytes, 0)
        : r.imuBytes + r.lidarBytes;

  const totals: Record<DataView, number> = {
    all: rows.reduce((n, r) => n + r.totalBytes, 0),
    camera: rows.reduce((n, r) => n + r.cameras.reduce((m, c) => m + c.bytes, 0), 0),
    sensors: rows.reduce((n, r) => n + r.imuBytes + r.lidarBytes, 0),
  };

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const from = f.from ? Date.parse(`${f.from}T00:00:00Z`) : -Infinity;
    const to = f.to ? Date.parse(`${f.to}T00:00:00Z`) + 86_400_000 : Infinity;
    const out = rows.filter((r) => {
      if (bytesOf(r, f.type) <= 0) return false;
      if (f.robot && r.robotId !== f.robot) return false;
      if (f.status && r.status !== f.status) return false;
      if ((f.from || f.to) && (r.start === null || r.start < from || r.start >= to)) return false;
      if (q && ![r.robotId, r.sessionId, r.trip ?? ""].some((s) => s.toLowerCase().includes(q))) return false;
      return true;
    });
    const by: Record<Filters["sort"], (a: DataRow, b: DataRow) => number> = {
      newest: (a, b) => (b.start ?? 0) - (a.start ?? 0),
      oldest: (a, b) => (a.start ?? 0) - (b.start ?? 0),
      longest: (a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0),
      largest: (a, b) => bytesOf(b, f.type) - bytesOf(a, f.type),
    };
    return out.sort(by[f.sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, f]);

  const groupByDay = f.sort === "newest" || f.sort === "oldest";
  const active = (["q", "robot", "cam", "status", "from", "to"] as const).filter((k) => f[k]).length;
  const ofType = rows.filter((r) => bytesOf(r, f.type) > 0).length;
  const clear = () => setF((p) => ({ ...DEFAULTS, type: p.type, sort: p.sort }));
  const control =
    "h-9 w-full rounded-md border border-border bg-panel px-2.5 text-sm text-text transition-colors hover:border-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30";

  // sessions grouped under a day heading when sorted by time
  const groups: Array<{ day: string | null; items: DataRow[] }> = [];
  for (const r of shown) {
    const day = groupByDay ? dayKey(r.start) : null;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(r);
    else groups.push({ day, items: [r] });
  }

  return (
    <div className="space-y-4">
      {/* data type */}
      <div role="group" aria-label="Data type" className="grid gap-2 md:grid-cols-3">
        {TYPES.map((t) => {
          const on = f.type === t.value;
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={on}
              onClick={() => setF((p) => ({ ...p, type: t.value, cam: "" }))}
              className={`flex items-center gap-3 rounded-xl border bg-panel px-4 py-3 text-left shadow-card transition-colors ${
                on ? "border-accent ring-1 ring-accent" : "border-border hover:border-faint"
              }`}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? "bg-accent text-on-accent" : "bg-panel-2 text-muted"}`}>
                {t.value === "all" ? <BoxIcon /> : t.value === "camera" ? <CameraIcon /> : <SensorIcon />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{t.label}</span>
                  <span className="tabular text-sm text-muted">{formatBytes(totals[t.value])}</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted">{t.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* filters */}
      <form
        role="search"
        aria-label="Filter sessions"
        onSubmit={(e) => e.preventDefault()}
        className="rounded-xl border border-border bg-panel p-4 shadow-card"
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(15rem,2fr)_repeat(4,minmax(0,1fr))_minmax(0,2fr)]">
          <Field label="Search" htmlFor="data-q" hint="Press / to search" wide>
            <div className="relative">
              <svg className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <circle cx="6" cy="6" r="4.2" />
                <path d="m9.2 9.2 3.3 3.3" strokeLinecap="round" />
              </svg>
              <input
                id="data-q"
                ref={searchRef}
                type="search"
                value={f.q}
                onChange={(e) => set("q", e.target.value)}
                placeholder="Session ID, robot or trip"
                autoComplete="off"
                className={`${control} pl-8`}
              />
            </div>
          </Field>
          <Field label="Robot" htmlFor="data-robot">
            <select id="data-robot" value={f.robot} onChange={(e) => set("robot", e.target.value)} className={control}>
              <option value="">All robots</option>
              {robots.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Camera" htmlFor="data-cam">
            <select
              id="data-cam"
              value={f.cam}
              onChange={(e) => set("cam", e.target.value)}
              disabled={f.type !== "camera"}
              className={`${control} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <option value="">{f.type === "camera" ? "All cameras" : "Not applicable"}</option>
              {allCams.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="data-status">
            <select id="data-status" value={f.status} onChange={(e) => set("status", e.target.value as Filters["status"])} className={control}>
              <option value="">Any status</option>
              <option value="closed">Closed</option>
              <option value="active">Recording</option>
              <option value="interrupted">Interrupted</option>
            </select>
          </Field>
          <Field label="Sort by" htmlFor="data-sort">
            <select id="data-sort" value={f.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])} className={control}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="longest">Longest</option>
              <option value="largest">Largest</option>
            </select>
          </Field>
          <fieldset className="col-span-2 min-w-0 lg:col-span-1">
            <legend className="mb-1.5 text-xs font-medium text-muted">Date range (UTC)</legend>
            <div className="flex items-center gap-1.5">
              <input type="date" aria-label="From" value={f.from} max={f.to || undefined} onChange={(e) => set("from", e.target.value)} className={`${control} min-w-0`} />
              <span className="text-xs text-muted" aria-hidden>–</span>
              <input type="date" aria-label="To" value={f.to} min={f.from || undefined} onChange={(e) => set("to", e.target.value)} className={`${control} min-w-0`} />
            </div>
          </fieldset>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-3 text-sm">
          <p aria-live="polite" className="tabular">
            <span className="font-semibold">{shown.length}</span>
            <span className="text-muted"> of {ofType} session{ofType === 1 ? "" : "s"}</span>
          </p>
          <p className="tabular">
            <span className="text-muted">Recorded </span>
            <span className="font-semibold">{formatDuration(shown.reduce((n, r) => n + (r.durationSec ?? 0), 0))}</span>
          </p>
          <p className="tabular">
            <span className="text-muted">Size </span>
            <span className="font-semibold">{formatBytes(shown.reduce((n, r) => n + bytesOf(r, f.type), 0))}</span>
          </p>
          {active > 0 && (
            <button type="button" onClick={clear} className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:border-accent hover:text-accent">
              Clear {active} filter{active === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </form>

      {/* results */}
      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-panel px-6 py-16 text-center">
          <p className="font-medium">No sessions match</p>
          <p className="mt-1 text-sm text-muted">
            {active > 0 ? "Try a different search, or clear the filters." : "Nothing of this data type has been uploaded yet."}
          </p>
          {active > 0 && (
            <button type="button" onClick={clear} className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* desktop: table */}
          <section aria-label="Sessions" className="hidden overflow-hidden rounded-xl border border-border bg-panel shadow-card lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Sessions with downloadable {f.type === "all" ? "data" : f.type === "camera" ? "camera video" : "LiDAR and IMU data"}
              </caption>
              <thead>
                <tr className="border-b border-border bg-panel-2/60 text-left text-[11px] whitespace-nowrap uppercase tracking-wide text-muted">
                  <th scope="col" className="px-4 py-2 font-medium">Session</th>
                  <th scope="col" className="px-4 py-2 font-medium">Robot</th>
                  <th scope="col" className="px-4 py-2 font-medium">Started</th>
                  <th scope="col" className="px-4 py-2 font-medium">Duration</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Size</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Download</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.day ?? "all"} className="tabular">
                  {g.day && (
                    <tr className="border-b border-border bg-panel-2/40">
                      <th scope="rowgroup" colSpan={7} className="px-4 py-1.5 text-left text-xs font-medium text-muted">
                        {dayLabel(g.day)}
                        <span className="ml-2 font-normal">· {g.items.length} session{g.items.length === 1 ? "" : "s"}</span>
                      </th>
                    </tr>
                  )}
                  {g.items.map((r) => (
                    <tr key={`${r.robotId}/${r.sessionId}`} className="border-b border-border hover:bg-panel-2/60">
                      <td className="px-4 py-2.5">
                        <SessionName r={r} q={f.q} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <Link href={`/robots/${encodeURIComponent(r.robotId)}`} className="font-mono hover:text-accent hover:underline">
                          <Highlight text={r.robotId} q={f.q} />
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {groupByDay && r.start !== null ? `${formatClock(r.start).slice(0, 5)} UTC` : formatDateTime(r.start)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDuration(r.durationSec)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col items-start gap-1 whitespace-nowrap">
                          <StatusBadge status={r.status} />
                          <UploadBadge status={r.status} upload={r.upload} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted">{formatBytes(bytesOf(r, f.type))}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Downloads r={r} type={f.type} cam={f.cam} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </section>

          {/* phone and tablet: cards */}
          <div className="space-y-4 lg:hidden">
            {groups.map((g) => (
              <section key={g.day ?? "all"} aria-label={g.day ? dayLabel(g.day) : "Sessions"}>
                {g.day && (
                  <h2 className="mb-2 px-1 text-xs font-medium text-muted">
                    {dayLabel(g.day)} · {g.items.length} session{g.items.length === 1 ? "" : "s"}
                  </h2>
                )}
                <ul className="space-y-2">
                  {g.items.map((r) => (
                    <li key={`${r.robotId}/${r.sessionId}`} className="rounded-xl border border-border bg-panel p-4 shadow-card">
                      <SessionName r={r} q={f.q} />
                      <div className="mt-2 flex flex-wrap gap-1">
                        <StatusBadge status={r.status} />
                        <UploadBadge status={r.status} upload={r.upload} />
                      </div>
                      <dl className="tabular mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                        <CardFact label="Robot" mono>{r.robotId}</CardFact>
                        <CardFact label="Started">{r.start !== null ? `${formatClock(r.start).slice(0, 5)} UTC` : "—"}</CardFact>
                        <CardFact label="Duration">{formatDuration(r.durationSec)}</CardFact>
                        <CardFact label="Size">{formatBytes(bytesOf(r, f.type))}</CardFact>
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
                        <Downloads r={r} type={f.type} cam={f.cam} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  wide,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  /** full width on small screens */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2 lg:col-span-1" : ""}`}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
          {label}
        </label>
        {hint && <span className="hidden text-[11px] text-muted lg:inline">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function CardFact({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function SessionName({ r, q }: { r: DataRow; q: string }) {
  return (
    <div className="min-w-0">
      <Link
        href={`/robots/${encodeURIComponent(r.robotId)}/sessions/${encodeURIComponent(r.sessionId)}`}
        className="font-mono font-medium break-all text-accent hover:underline"
      >
        <Highlight text={r.sessionId} q={q} />
      </Link>
      {(r.trip || r.simulated) && (
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          {r.trip && <Highlight text={r.trip} q={q} />}
          {r.simulated && <span className="rounded border border-warn/40 px-1 text-[10px] text-warn">Simulated</span>}
        </div>
      )}
    </div>
  );
}

function Downloads({ r, type, cam }: { r: DataRow; type: DataView; cam: string }) {
  const apiBase = `/api/robots/${encodeURIComponent(r.robotId)}/sessions/${encodeURIComponent(r.sessionId)}`;
  const base = `${r.robotId}_${r.sessionId}`;
  if (type === "all")
    return <DownloadButton apiBase={apiBase} fileName={`${base}.zip`} totalBytes={r.totalBytes} what={{ type: "session" }} label="Session .zip" />;
  if (type === "camera")
    return (
      <>
        {r.cameras
          .filter((c) => !cam || c.camera === cam)
          .map((c) => (
            <DownloadButton
              key={c.camera}
              apiBase={apiBase}
              fileName={`${base}_${c.camera}.ts`}
              totalBytes={c.bytes}
              what={{ type: "camera", camera: c.camera }}
              label={c.camera}
            />
          ))}
      </>
    );
  return (
    <>
      {r.imuBytes > 0 && (
        <DownloadButton apiBase={apiBase} fileName={`${base}_imu.csv`} totalBytes={r.imuBytes} what={{ type: "imu" }} label="IMU .csv" />
      )}
      {r.lidarBytes > 0 && (
        <DownloadButton apiBase={apiBase} fileName={`${base}_lidar.npz`} totalBytes={r.lidarBytes} what={{ type: "lidar" }} label="LiDAR .zip" />
      )}
    </>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-accent-soft text-inherit">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

const svg = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true } as const;
function BoxIcon() {
  return (
    <svg {...svg}>
      <path d="M2.5 5.5 9 2.5l6.5 3v7L9 15.5l-6.5-3z" strokeLinejoin="round" />
      <path d="M2.5 5.5 9 8.5l6.5-3M9 8.5v7" strokeLinejoin="round" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg {...svg}>
      <rect x="1.8" y="4.5" width="10.5" height="9" rx="1.5" />
      <path d="m12.3 8 3.9-2.2v6.4L12.3 10" strokeLinejoin="round" />
    </svg>
  );
}
function SensorIcon() {
  return (
    <svg {...svg}>
      <circle cx="9" cy="9" r="1.6" />
      <path d="M5.5 5.5a5 5 0 0 0 0 7M12.5 5.5a5 5 0 0 1 0 7M3.2 3.2a8.2 8.2 0 0 0 0 11.6M14.8 3.2a8.2 8.2 0 0 1 0 11.6" strokeLinecap="round" />
    </svg>
  );
}
