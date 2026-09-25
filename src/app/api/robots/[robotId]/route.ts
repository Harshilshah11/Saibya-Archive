import { NextResponse } from "next/server";
import { getRobotLink, listRobotIds, listSessions } from "@/lib/archive";
import type { RobotDetail } from "@/lib/types";

// One robot: its sessions (newest first) and latest heartbeat. 404 for an unknown robot.
export async function GET(_req: Request, { params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!(await listRobotIds()).includes(robotId)) {
    return NextResponse.json({ error: "Robot not found" }, { status: 404 });
  }
  const [sessions, link] = await Promise.all([listSessions(robotId), getRobotLink(robotId)]);
  return NextResponse.json({ robotId, sessions, link } satisfies RobotDetail);
}
