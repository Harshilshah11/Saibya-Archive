import { NextResponse, type NextRequest } from "next/server";
import { listStorageFiles, listStorageRobotIds, listStorageSessionIds, readStorageManifest } from "@/lib/archive";
import { isAdmin } from "@/lib/auth";
import { ingest, type IngestEvent } from "@/lib/catalog";
import { dbEnabled, sql } from "@/lib/db";
import { robotOwner, SESSION_FILE } from "@/lib/keys";

// Rebuilds the database index from S3 (S3 is the source of truth):
//   - once after creating the database, to load the sessions recorded before v3
//   - any time a robot could not reach the server (its uploads still landed in S3)
//
//   POST /api/admin/reindex                  Authorization: Bearer $ADMIN_TOKEN
//        ?robot=saibya02                     only this app robot id (default: all)
//        ?full=1                             also re-read sessions already marked complete
// Idempotent; safe to run while robots upload. Uses webapp-reader's s3:ListBucket.

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!dbEnabled) return NextResponse.json({ error: "No database configured (DATABASE_URL)" }, { status: 503 });
  if (!isAdmin(req)) return NextResponse.json({ error: "Admin token required" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const full = q.get("full") === "1";
  const only = q.get("robot");

  const robots = only ? [only] : await listStorageRobotIds();
  const report: Array<{ robot: string; sessions: number; skipped: number; files: number; rejected: number }> = [];
  for (const robotId of robots) {
    await sql()`insert into robots (id) values (${robotOwner(robotId)}) on conflict do nothing`;
    const done = new Set(
      full
        ? []
        : (await sql()`select session_id from sessions where robot_id = ${robotId} and complete`).map(
            (r) => r.session_id as string,
          ),
    );
    const line = { robot: robotId, sessions: 0, skipped: 0, files: 0, rejected: 0 };
    for (const sessionId of await listStorageSessionIds(robotId)) {
      if (done.has(sessionId)) {
        line.skipped++;
        continue;
      }
      const files = await listStorageFiles(robotId, sessionId);
      if (!files.length) continue;
      const manifest = files.some((f) => f.name === SESSION_FILE) ? await readStorageManifest(robotId, sessionId) : null;
      // session.json first, so the session row has its metadata before the rest lands
      const events: IngestEvent[] = files
        .sort((a, b) => Number(b.name === SESSION_FILE) - Number(a.name === SESSION_FILE))
        .map((f) => ({
          key: f.key,
          size: f.size,
          uploaded_at: new Date(f.lastModified).toISOString(),
          manifest: f.name === SESSION_FILE ? manifest : undefined,
        }));
      for (let i = 0; i < events.length; i += 500) {
        const res = await ingest(events.slice(i, i + 500), null);
        line.files += res.accepted;
        line.rejected += res.rejected.length;
      }
      line.sessions++;
    }
    report.push(line);
  }
  return NextResponse.json({ ok: true, robots: report });
}
