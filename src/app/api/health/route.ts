import { NextResponse } from "next/server";
import { config, demoMode } from "@/lib/config";
import { storage } from "@/lib/storage";

// Checks that the app can list the bucket, and explains the usual failure causes.
export async function GET() {
  if (demoMode) return NextResponse.json({ ok: true, mode: "demo" });
  try {
    await storage.listPrefixes("");
    return NextResponse.json({ ok: true, mode: "s3", bucket: config.bucket, region: config.region });
  } catch (err) {
    const e = err as { name?: string; message?: string; code?: string };
    const text = `${e.name ?? ""} ${e.code ?? ""} ${e.message ?? ""}`;
    const hint = /AccessDenied|Forbidden/i.test(text)
      ? "The webapp-reader key is missing s3:ListBucket or s3:GetObject on the bucket."
      : /InvalidAccessKeyId|SignatureDoesNotMatch|CredentialsProviderError|Could not load credentials/i.test(text)
        ? "The access key is wrong or missing. Check S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY."
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
