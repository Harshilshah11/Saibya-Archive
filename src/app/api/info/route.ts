import { NextResponse } from "next/server";
import { indexMode, storageMode } from "@/lib/archive";
import { config } from "@/lib/config";
import type { ApiInfo } from "@/lib/types";

// Static facts the web app shows (demo badge, "interrupted after N minutes"). Cheap: unlike
// /api/health it touches neither S3 nor the database.
export function GET() {
  return NextResponse.json({
    service: "saibya-archive-server",
    mode: storageMode(),
    index: indexMode(),
    interruptedAfterMin: config.interruptedAfterMin,
  } satisfies ApiInfo);
}
