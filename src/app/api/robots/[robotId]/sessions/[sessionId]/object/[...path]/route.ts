import { NextResponse, type NextRequest } from "next/server";
import { sessionPrefix } from "@/lib/keys";
import { storage } from "@/lib/storage";

// Redirects to a freshly presigned S3 URL for one file of a session. The player and
// the downloads use these URLs instead of presigned ones, so nothing expires mid-watch.
// Only paths inside the session folder can be requested.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ robotId: string; sessionId: string; path: string[] }> },
) {
  const { robotId, sessionId, path } = await params;
  const parts = [robotId, sessionId, ...path].map((p) => decodeURIComponent(p));
  if (parts.some((p) => !p || p === "." || p === ".." || p.includes("/") || p.includes("\\"))) {
    return new NextResponse("Bad path", { status: 400 });
  }
  const [robot, session, ...rest] = parts;
  const name = rest.join("/");
  const download = req.nextUrl.searchParams.get("download") === "1" ? rest[rest.length - 1] : undefined;

  const url = await storage.signedUrl(sessionPrefix(robot, session) + name, download);
  const res = NextResponse.redirect(new URL(url, req.url), 302);
  // the presigned URL lives longer than this, so a short browser cache is safe
  res.headers.set("Cache-Control", "private, max-age=300");
  return res;
}
