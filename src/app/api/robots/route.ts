import { NextResponse } from "next/server";
import { listRobots } from "@/lib/archive";

// Every robot with its sessions (newest first), sizes and latest heartbeat. The web app's
// Robots overview.
export async function GET() {
  return NextResponse.json({ robots: await listRobots() });
}
