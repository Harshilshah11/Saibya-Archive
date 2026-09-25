import { NextResponse, type NextRequest } from "next/server";
import { demoMode } from "@/lib/config";
import { contentTypeFor, sessionPrefix } from "@/lib/keys";
import { storage } from "@/lib/storage";
import { getObjectRange } from "@/lib/storage/s3";

// Streams one file of a session from S3 through the Server (v4): the browser never sees an
// S3 URL, so the bucket needs no CORS and no public access. The Range header is passed
// through, so video seeking gets 206 partial responses.
// Only paths inside the session folder can be requested. ?download=1 saves it as a file.

export const runtime = "nodejs";

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
  const key = sessionPrefix(robot, session) + name;
  const download = req.nextUrl.searchParams.get("download") === "1" ? rest[rest.length - 1] : undefined;

  // Demo mode has no bucket: its generated files are served by /api/demo/object.
  if (demoMode) return NextResponse.redirect(new URL(await storage.signedUrl(key, download), req.url), 302);

  const range = req.headers.get("range") ?? undefined;
  let obj;
  try {
    obj = await getObjectRange(key, range);
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (e.name === "InvalidRange" || e.$metadata?.httpStatusCode === 416) {
      return new NextResponse("Range not satisfiable", { status: 416 });
    }
    console.error(`object ${key}:`, err);
    return new NextResponse("Could not read the file from S3", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": contentTypeFor(name),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
  });
  if (obj.ContentLength !== undefined) headers.set("Content-Length", String(obj.ContentLength));
  if (obj.ContentRange) headers.set("Content-Range", obj.ContentRange);
  if (obj.ETag) headers.set("ETag", obj.ETag);
  if (obj.LastModified) headers.set("Last-Modified", obj.LastModified.toUTCString());
  if (download) headers.set("Content-Disposition", `attachment; filename="${download.replace(/"/g, "")}"`);

  const body = obj.Body?.transformToWebStream() ?? null;
  return new NextResponse(body as BodyInit | null, { status: range && obj.ContentRange ? 206 : 200, headers });
}
