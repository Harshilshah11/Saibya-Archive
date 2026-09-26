import { NextResponse } from "next/server";

// The Server has no pages: the web app (main branch) is the UI. This lists what it serves.
export function GET() {
  return NextResponse.json({
    service: "saibya-archive-server",
    endpoints: {
      read: [
        "GET /api/info",
        "GET /api/health",
        "GET /api/robots",
        "GET /api/robots/:robotId",
        "GET /api/robots/:robotId/sessions/:sessionId",
        "GET /api/robots/:robotId/sessions/:sessionId/files",
        "GET /api/robots/:robotId/sessions/:sessionId/object/*path",
        "GET /api/robots/:robotId/sessions/:sessionId/cameras/:camera/playlist",
        "GET /api/robots/:robotId/sessions/:sessionId/cameras/:camera/mp4",
        "GET /api/data",
      ],
      robot: ["PUT /api/ingest/upload", "POST /api/ingest", "POST /api/ingest/heartbeat"],
      admin: ["POST /api/admin/reindex"],
    },
  });
}
