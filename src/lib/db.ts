import "server-only";
import postgres from "postgres";

// Postgres (Neon on Vercel, or any Postgres) holding the v3 index: robots, trips,
// sessions, files. Without DATABASE_URL the app falls back to listing S3 (v2).
const url = process.env.DATABASE_URL ?? "";

export const dbEnabled = url !== "";

type Sql = ReturnType<typeof postgres>;

// One pool per server instance; `globalThis` keeps it across hot reloads in dev.
const g = globalThis as unknown as { __saibyaSql?: Sql };

export function sql(): Sql {
  if (!dbEnabled) throw new Error("DATABASE_URL is not set");
  g.__saibyaSql ??= postgres(url, {
    max: 5,
    idle_timeout: 20,
    // Neon's pooled endpoint (PgBouncer) does not keep prepared statements
    prepare: false,
    onnotice: () => {},
  });
  return g.__saibyaSql;
}
