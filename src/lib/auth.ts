import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "./db";

// Bearer tokens for the machine-to-server routes:
//   device token  one per robot, stored as sha256 in robots.token_hash (npm run robot:add)
//   ADMIN_TOKEN   env var, for POST /api/admin/reindex

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Robot id owning this device token, or null. */
export async function robotForToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  const [row] = await sql()`select id from robots where token_hash = ${sha256(token)}`;
  return row ? (row.id as string) : null;
}

export function isAdmin(req: Request): boolean {
  const want = process.env.ADMIN_TOKEN ?? "";
  const got = bearer(req) ?? "";
  if (want.length < 16 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
