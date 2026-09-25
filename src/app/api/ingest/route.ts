import { NextResponse, type NextRequest } from "next/server";
import { bearer, robotForToken } from "@/lib/auth";
import { ingest, type IngestEvent } from "@/lib/catalog";
import { dbEnabled } from "@/lib/db";

// cloud_sync on the robot reports every object it uploaded to S3:
//   POST /api/ingest   Authorization: Bearer <device token>
//   { "events": [ { "key": "saibya02/sessions/<id>/video/cam1/20260924_134701.ts",
//                   "size": 1234, "uploaded_at": 1790304390.1,
//                   "manifest": { ...session.json... }   (only with session.json) } ] }
// -> { accepted, rejected: [{ key, error }] }. Idempotent: a retried event updates the same row.
// A robot's token only accepts keys under its own prefix.

const MAX_EVENTS = 500;

export async function POST(req: NextRequest) {
  if (!dbEnabled) return NextResponse.json({ error: "No database configured (DATABASE_URL)" }, { status: 503 });
  const robot = await robotForToken(bearer(req));
  if (!robot) return NextResponse.json({ error: "Invalid device token" }, { status: 401 });

  let events: IngestEvent[];
  try {
    const body = await req.json();
    events = Array.isArray(body?.events) ? body.events : [];
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { events: [...] }" }, { status: 400 });
  }
  if (!events.length || events.length > MAX_EVENTS) {
    return NextResponse.json({ error: `Send 1-${MAX_EVENTS} events` }, { status: 400 });
  }
  return NextResponse.json(await ingest(events, robot));
}
