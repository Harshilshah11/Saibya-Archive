import { NextResponse } from "next/server";
import { config, demoMode } from "@/lib/config";
import { dbEnabled, sql } from "@/lib/db";
import { storage } from "@/lib/storage";

// Checks that the app can reach the database (v3) and list the bucket, and explains the
// usual failure causes.
export async function GET() {
  if (dbEnabled) {
    try {
      await sql()`select 1 from sessions limit 1`;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const hint = e.code === "42P01"
        ? "The tables don't exist yet. Run: npm run db:migrate"
        : "Can't reach the database. Check DATABASE_URL.";
      return NextResponse.json({ ok: false, error: "Database", detail: e.message, hint }, { status: 503 });
    }
  }
  const index = dbEnabled ? "db" : "s3";
  if (demoMode) return NextResponse.json({ ok: true, mode: "demo", index });
  try {
    await storage.listPrefixes("");
    return NextResponse.json({ ok: true, mode: "s3", index, bucket: config.bucket, region: config.region });
  } catch (err) {
    const e = err as { name?: string; message?: string; code?: string };
    const text = `${e.name ?? ""} ${e.code ?? ""} ${e.message ?? ""}`;
    // On the Server there are no keys: credentials come from the EC2 instance's IAM role.
    const keys = Boolean(config.accessKeyId);
    const hint = /AccessDenied|Forbidden/i.test(text)
      ? keys
        ? "The access key is missing s3:ListBucket or s3:GetObject on the bucket."
        : "The instance's IAM role is missing s3:ListBucket / GetObject / PutObject on the bucket."
      : /InvalidAccessKeyId|SignatureDoesNotMatch|CredentialsProviderError|Could not load credentials/i.test(text)
        ? keys
          ? "The access key is wrong. Check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY."
          : "No AWS credentials. Attach the saibya-archive-server IAM role to the EC2 instance."
        : /NoSuchBucket/i.test(text)
          ? `Bucket "${config.bucket}" doesn't exist. Check S3_BUCKET.`
          : /PermanentRedirect|AuthorizationHeaderMalformed|region/i.test(text)
            ? `The bucket isn't in ${config.region}. Check S3_REGION.`
            : /ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(text)
              ? "The server can't reach AWS. Check the internet connection."
              : "Unexpected S3 error.";
    return NextResponse.json({ ok: false, error: e.name ?? "Error", hint }, { status: 503 });
  }
}
