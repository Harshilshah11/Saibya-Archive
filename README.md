# Saibya Archive: Server

The backend of the Saibya archive: robots upload through it, it keeps the Postgres index, and it serves the archive to the web app as a JSON API. It has **no pages**. The UI is the web app on the `main` branch, which calls this API.

| Branch | What | Runs on |
|---|---|---|
| `server` (this) | API: ingest, Postgres index, S3 access | EC2 `43.204.46.19`, `/opt/saibya/app`, pm2 `saibya-archive`, nginx :80 → :3000 |
| `main` | Web app: pages, player, downloads | Locally (`npm run dev`), talks to this API |

There is no viewer auth yet. The read API is open to anyone who can reach the server, so keep it off a public domain until auth is added. The robot and admin routes need bearer tokens.

## API

Read (the web app):

| Route | Returns |
|---|---|
| `GET /` | This list of endpoints |
| `GET /api/info` | `{ service, mode: s3/demo, index: db/s3, interruptedAfterMin }` (no S3 or DB call) |
| `GET /api/health` | Checks the database and S3, with a plain-language hint on failure |
| `GET /api/robots` | Every robot with its sessions, sizes and latest heartbeat |
| `GET /api/robots/:robot` | `{ robotId, sessions, link }`, 404 for an unknown robot |
| `GET /api/robots/:robot/sessions/:session` | `{ session, files (with download URLs), cameras (segments for the player) }` |
| `GET /api/robots/:robot/sessions/:session/files` | File list with URLs (`?kind=camera\|sensors\|meta`, `?camera=`, `?sensor=lidar\|imu`, `?download=1`) |
| `GET /api/robots/:robot/sessions/:session/object/<path>` | Streams one file from S3 (Range supported, `?download=1` sets the file name) |
| `GET /api/robots/:robot/sessions/:session/cameras/:cam/playlist` | HLS VOD playlist over the camera's `.ts` chunks |
| `GET /api/robots/:robot/sessions/:session/cameras/:cam/mp4` | The whole camera as one MP4 that plays on Windows, macOS (QuickTime) and phones (`?download=1` saves it). Built from the chunks on first request (stream copy; H.265 tagged `hvc1` for QuickTime) and cached in `MP4_CACHE_DIR` for `MP4_CACHE_HOURS` (24) |
| `GET /api/data` | `{ robots, rows }`: per-stream sizes of every session, for the web app's Data page |

URLs inside responses (file and playlist links) are relative (`/api/...`). The web app proxies `/api/*` to this server, so the browser uses them as they are.

Robot (`Authorization: Bearer <device token>`, one per robot, `npm run robot:add -- <robot>`):

| Route | What |
|---|---|
| `PUT /api/ingest/upload` | Upload one file; the server writes it to S3 and indexes it |
| `POST /api/ingest` | Report objects the robot uploaded to S3 itself: `{ events: [{ key, size, uploaded_at, manifest? }] }` |
| `POST /api/ingest/heartbeat` | cloud_sync status (current session, backlog, disk, alerts) about once a minute |

Admin (`Authorization: Bearer $ADMIN_TOKEN`):

| Route | What |
|---|---|
| `POST /api/admin/reindex` | Rebuild the index from S3 (`?robot=`, `?full=1`). S3 is the source of truth. |

## Index

- **`DATABASE_URL` set (EC2):** robots, sessions and files come from Postgres (`db/schema.sql`), filled by the ingest routes and the re-index.
- **No database:** everything is derived from S3 listings plus `session.json`.
- **No `S3_BUCKET`:** generated demo data (3 robots, 9 sessions), so the API and the web app can be developed offline.

## S3 layout

Written by `cloud_sync` on the robot:

```
arnobot-saibya-data/
  <robot_id>/sessions/<session_id>/          real sessions
  <robot_id>/sim/sessions/<session_id>/      bench simulation, shown as robot "<robot_id>-sim"
    session.json                             metadata; status / ended_at set when the session ends
    upload_log.csv                           every upload of the session (written at the end)
    _COMPLETE.json                           uploaded LAST: every file of the session is in S3
    video/<cam>/<YYYYMMDD_HHMMSS>.ts         camera segments (video_segment_s: 600 real, 60 simulated)
    sensors/lidar/<YYYYMMDD_HHMMSS>.npz      LiDAR scans
    sensors/imu/<YYYYMMDD_HHMMSS>.csv.gz     IMU samples
```

- Chunk names are the chunk start in robot local time (`ROBOT_UTC_OFFSET`, default `+05:30`). Names ending in `Z` are UTC.
- **Status:** `session.json` with `ended_at`, or a final status → closed. Otherwise active if the robot's heartbeat names the session or something was uploaded in the last `INTERRUPTED_AFTER_MINUTES`, else interrupted.
- `*.part` and `*.tmp` are ignored.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in, or leave S3_BUCKET empty for demo data
npm run dev                  # http://localhost:3100
```

Port 3100 leaves 3000 for the web app. Point the web app at this Server with `API_URL=http://localhost:3100` in its `.env.local`. Without `DATABASE_URL` it reads S3 directly, so no local Postgres is needed; the robot ingest routes need the database.

## Deploy (EC2)

```bash
ssh -i saibya-archive-server.pem ubuntu@43.204.46.19
cd /opt/saibya/app
git pull --ff-only origin server
npm ci                        # only when package-lock.json changed
npm run db:migrate            # only when db/schema.sql changed
npm run build
pm2 restart saibya-archive
curl -s http://127.0.0.1:3000/api/health
```

Config lives in `/opt/saibya/app/.env.production` (see `.env.example`). S3 credentials come from the instance's IAM role; Postgres runs on the same instance and is dumped nightly to `/opt/saibya/backups` (crontab).

## Folder structure

```
src/
  app/
    route.ts                                  GET / (endpoint list)
    api/info, health                          service facts, S3 + DB check
    api/robots/...                            robots, sessions, files, object stream, HLS playlist
    api/data                                  per-stream sizes for the Data page
    api/ingest/{upload,heartbeat}, api/ingest robot uploads and status
    api/admin/reindex                         rebuild the index from S3
    api/demo/object                           stands in for S3 in demo mode
  lib/
    archive.ts     sessions, status, summaries (from Postgres or S3)
    catalog.ts     Postgres reads and writes
    keys.ts        S3 key layout and chunk-name parsing
    storage/       s3.ts (AWS SDK), demo.ts (generated data)
    auth.ts  config.ts  db.ts  types.ts
db/schema.sql      Postgres schema
scripts/           db-migrate.mjs, robot-add.mjs
```
