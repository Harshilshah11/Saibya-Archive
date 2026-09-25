import "server-only";
import { config } from "./config";
import { sql } from "./db";
import { classify, COMPLETE_FILE, parseSessionKey, SESSION_FILE } from "./keys";
import type { ArchiveFile, FileKind, Manifest, RobotLinkInfo, SensorKind } from "./types";

// The index in Postgres. Writes come from the robots (PUT /api/ingest/upload, v3 POST /api/ingest) and from the
// S3 re-index (POST /api/admin/reindex); reads serve every page in place of S3 listings.

/** One uploaded S3 object, as reported by cloud_sync (or found by the re-index). */
export interface IngestEvent {
  key: string;
  size: number;
  /** When S3 accepted it: ISO string or epoch seconds. Default: now. */
  uploaded_at?: string | number;
  /** session.json contents, sent along with the session.json upload */
  manifest?: Manifest | null;
  /** sha256 (hex) of the bytes, when the Server stored them itself (PUT /api/ingest/upload) */
  sha256?: string | null;
}

export interface IngestResult {
  accepted: number;
  rejected: Array<{ key: string; error: string }>;
}

function toDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v * 1000);
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return new Date(t);
  }
  return null;
}

/**
 * Records uploaded objects. Idempotent: the same key sent twice updates one row, so the
 * robot can retry freely. `owner` limits a robot's token to its own prefix.
 */
export async function ingest(events: IngestEvent[], owner: string | null): Promise<IngestResult> {
  const result: IngestResult = { accepted: 0, rejected: [] };
  const valid: Array<{ ev: IngestEvent; file: ArchiveFile; robotId: string; sessionId: string }> = [];
  for (const ev of events) {
    const key = typeof ev?.key === "string" ? ev.key : "";
    const size = Number(ev?.size);
    const parsed = parseSessionKey(key);
    if (!parsed || !Number.isFinite(size) || size < 0) {
      result.rejected.push({ key, error: "bad key or size" });
      continue;
    }
    if (owner !== null && parsed.owner !== owner) {
      result.rejected.push({ key, error: `token is for robot ${owner}` });
      continue;
    }
    const uploaded = toDate(ev.uploaded_at) ?? new Date();
    const file = classify({ key, size, lastModified: uploaded }, key.slice(0, key.length - parsed.name.length),
      config.robotUtcOffsetMin);
    if (!file) {
      result.rejected.push({ key, error: "not a session file (.part / .tmp)" });
      continue;
    }
    valid.push({ ev, file, robotId: parsed.robotId, sessionId: parsed.sessionId });
  }
  if (!valid.length) return result;

  await sql().begin(async (tx) => {
    for (const { ev, file, robotId, sessionId } of valid) {
      await tx`insert into sessions (robot_id, session_id) values (${robotId}, ${sessionId})
               on conflict do nothing`;
      const m = ev.manifest;
      if (file.name === SESSION_FILE && m && typeof m === "object") {
        const trip = typeof m.trip === "string" && m.trip.trim() ? m.trip.trim().slice(0, 200) : null;
        let tripId: string | null = null;
        if (trip) {
          const [row] = await tx`insert into trips (name) values (${trip})
                                 on conflict (name) do update set name = excluded.name returning id`;
          tripId = String(row.id);
        }
        await tx`update sessions set
                   manifest = ${tx.json(m as Parameters<typeof tx.json>[0])},
                   status = ${typeof m.status === "string" ? m.status : null},
                   started_at = ${toDate(m.started_at) ?? toDate(m.started_unix)},
                   ended_at = ${toDate(m.ended_at) ?? toDate(m.ended_unix)},
                   stop_reason = ${typeof m.stop_reason === "string" ? m.stop_reason : null},
                   simulated = ${m.simulated === true},
                   trip_id = coalesce(${tripId}, trip_id),
                   updated_at = now()
                 where robot_id = ${robotId} and session_id = ${sessionId}`;
      }
      if (file.name === COMPLETE_FILE) {
        await tx`update sessions set complete = true, updated_at = now()
                 where robot_id = ${robotId} and session_id = ${sessionId}`;
      }
      await tx`insert into files (key, robot_id, session_id, name, kind, camera, sensor, chunk_start, size, uploaded_at, sha256)
               values (${file.key}, ${robotId}, ${sessionId}, ${file.name}, ${file.kind}, ${file.camera ?? null},
                       ${file.sensor ?? null}, ${file.start === undefined ? null : new Date(file.start)},
                       ${file.size}, ${new Date(file.lastModified)}, ${ev.sha256 ?? null})
               on conflict (key) do update set size = excluded.size, uploaded_at = excluded.uploaded_at,
                                               sha256 = coalesce(excluded.sha256, files.sha256)`;
      result.accepted++;
    }
  });
  return result;
}

/** The indexed size and sha256 of one object, or null when it isn't indexed. */
export async function storedFile(key: string): Promise<{ size: number; sha256: string | null } | null> {
  const [r] = await sql()`select size, sha256 from files where key = ${key}`;
  return r ? { size: Number(r.size), sha256: (r.sha256 as string | null) ?? null } : null;
}

/** True once _COMPLETE.json is indexed: every file of the session is in S3 and none may change. */
export async function sessionComplete(robotId: string, sessionId: string): Promise<boolean> {
  const [r] = await sql()`select complete from sessions where robot_id = ${robotId} and session_id = ${sessionId}`;
  return r?.complete === true;
}

/**
 * After a failed upload overwrote the S3 object with bytes that don't match, drop the stored
 * hash so the robot's retry is uploaded again instead of being taken for a duplicate.
 */
export async function forgetSha256(key: string): Promise<void> {
  await sql()`update files set sha256 = null where key = ${key}`;
}

/** Robot heartbeat: cloud_sync's status (backlog, disk, alerts, current session). */
export async function recordHeartbeat(robotId: string, status: unknown): Promise<void> {
  await sql()`update robots set last_seen_at = now(), last_status = ${sql().json(
    (status ?? {}) as Parameters<ReturnType<typeof sql>["json"]>[0],
  )} where id = ${robotId}`;
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function robotIds(): Promise<string[]> {
  const rows = await sql()`select id from robots union select distinct robot_id from sessions order by 1`;
  return rows.map((r) => r.id as string);
}

export async function sessionFiles(robotId: string, sessionId: string): Promise<ArchiveFile[]> {
  const rows = await sql()`
    select key, name, kind, camera, sensor, chunk_start, size, uploaded_at from files
    where robot_id = ${robotId} and session_id = ${sessionId}
    order by chunk_start nulls first, name`;
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    kind: r.kind as FileKind,
    camera: r.camera ?? undefined,
    sensor: (r.sensor ?? undefined) as SensorKind | undefined,
    start: r.chunk_start ? (r.chunk_start as Date).getTime() : undefined,
    size: Number(r.size),
    lastModified: (r.uploaded_at as Date).getTime(),
  }));
}

/** Files of a session summed per (kind, camera, sensor): everything a session summary needs. */
export interface FileGroup {
  kind: FileKind;
  camera?: string;
  sensor?: SensorKind;
  count: number;
  bytes: number;
  /** earliest / latest chunk start, epoch ms */
  first: number | null;
  last: number | null;
  /** latest upload, epoch ms */
  uploaded: number | null;
}

export interface SessionRow {
  sessionId: string;
  manifest: Manifest | null;
  complete: boolean;
  trip: string | null;
  groups: FileGroup[];
}

const ms = (v: unknown) => (v ? Date.parse(String(v)) : null);

export async function sessionRows(robotId: string, sessionId?: string): Promise<SessionRow[]> {
  const rows = await sql()`
    select s.session_id, s.manifest, s.complete, t.name as trip,
      coalesce((
        select json_agg(g) from (
          select f.kind, f.camera, f.sensor, count(*)::int as count, sum(f.size)::bigint as bytes,
                 min(f.chunk_start) as first, max(f.chunk_start) as last, max(f.uploaded_at) as uploaded
          from files f
          where f.robot_id = s.robot_id and f.session_id = s.session_id
          group by f.kind, f.camera, f.sensor
        ) g
      ), '[]'::json) as groups
    from sessions s left join trips t on t.id = s.trip_id
    where s.robot_id = ${robotId} ${sessionId === undefined ? sql()`` : sql()`and s.session_id = ${sessionId}`}`;
  return rows.map((r) => ({
    sessionId: r.session_id,
    manifest: (r.manifest as Manifest | null) ?? null,
    complete: r.complete,
    trip: r.trip ?? null,
    groups: (r.groups as Array<Record<string, unknown>>).map((g) => ({
      kind: g.kind as FileKind,
      camera: (g.camera as string | null) ?? undefined,
      sensor: ((g.sensor as string | null) ?? undefined) as SensorKind | undefined,
      count: Number(g.count),
      bytes: Number(g.bytes),
      first: ms(g.first),
      last: ms(g.last),
      uploaded: ms(g.uploaded),
    })),
  }));
}

export type RobotLink = RobotLinkInfo;

export async function robotLink(owner: string): Promise<RobotLink | null> {
  const [r] = await sql()`select last_seen_at, last_status from robots where id = ${owner}`;
  if (!r?.last_seen_at) return null;
  const status = (r.last_status ?? {}) as Record<string, unknown>;
  const session = status.session as { session_id?: string } | null | undefined;
  return { seenAt: (r.last_seen_at as Date).getTime(), sessionId: session?.session_id ?? null, status };
}

export async function trips(): Promise<string[]> {
  const rows = await sql()`select name from trips order by created_at desc`;
  return rows.map((r) => r.name as string);
}
