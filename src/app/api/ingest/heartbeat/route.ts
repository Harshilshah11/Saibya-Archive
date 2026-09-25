import { NextResponse, type NextRequest } from "next/server";
import { bearer, robotForToken } from "@/lib/auth";
import { recordHeartbeat } from "@/lib/catalog";
import { dbEnabled } from "@/lib/db";

// cloud_sync posts its status about once a minute: current session, backlog, disk, alerts.
// The app uses it to tell "recording, uplink behind" from "interrupted", and shows the
// robot's link on the robot pages.
//   POST /api/ingest/heartbeat   Authorization: Bearer <device token>   { ...status }

export async function POST(req: NextRequest) {
  if (!dbEnabled) return NextResponse.json({ error: "No database configured (DATABASE_URL)" }, { status: 503 });
  const robot = await robotForToken(bearer(req));
  if (!robot) return NextResponse.json({ error: "Invalid device token" }, { status: 401 });
  let status: unknown;
  try {
    status = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (JSON.stringify(status).length > 64_000) {
    return NextResponse.json({ error: "Status too large" }, { status: 413 });
  }
  await recordHeartbeat(robot, status);
  return NextResponse.json({ ok: true, robot });
}
