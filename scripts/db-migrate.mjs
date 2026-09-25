// Creates / updates the v3 tables (db/schema.sql is idempotent).
//   npm run db:migrate          uses DATABASE_URL from the environment or .env.local
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (add it to .env.local, or run: vercel env pull .env.local)");
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  const tables = await sql`select table_name from information_schema.tables
                           where table_schema = 'public' order by 1`;
  console.log("schema OK:", tables.map((t) => t.table_name).join(", "));
} finally {
  await sql.end();
}
