// Registers a robot and prints its NEW device token (shown once; only its sha256 is stored).
// Running it again for the same robot rotates the token: the old one stops working.
//   npm run robot:add -- saibya02 ["Saibya 02"]
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const [id, name] = process.argv.slice(2);
if (!id || !/^[a-z0-9][a-z0-9_-]*$/i.test(id) || id.endsWith("-sim")) {
  console.error('usage: npm run robot:add -- <robot_id> ["display name"]   (robot_id = S3 prefix, e.g. saibya02)');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const token = randomBytes(32).toString("hex");
const hash = createHash("sha256").update(token).digest("hex");
const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql`insert into robots (id, name, token_hash) values (${id}, ${name ?? null}, ${hash})
            on conflict (id) do update set token_hash = excluded.token_hash,
                                           name = coalesce(excluded.name, robots.name)`;
  console.log(`robot ${id} registered. Put these in the robot's GCS/backend/credential.txt:\n`);
  console.log(`CLOUD_SYNC_DEVICE_TOKEN=${token}`);
  console.log(`\n(and CLOUD_SYNC_SERVER_URL=https://<your-app>.vercel.app in .env_docker)`);
} finally {
  await sql.end();
}
