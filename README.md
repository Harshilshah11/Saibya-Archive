# Saibya Archive: web app

The team-facing viewer for recorded robot sessions: camera video, LiDAR and IMU that `cloud_sync` on the Jetson uploads to S3. This is the "Web App" box in `references/Task.excalidraw` (SAIBYA → AWS Session Sync v2).

- **By robot:** robots → sessions (recording / closed / interrupted) → the 4 cameras playing in sync, plus downloads.
- **By data type:** camera or LiDAR + IMU data across every robot and session, filterable by robot and camera.
- **One file per stream:** the robot uploads short chunks, but you get one video per camera, one IMU CSV and one LiDAR ZIP per session. The browser joins the chunks straight from presigned S3 URLs, with no server work.

There is no auth yet (planned: NextAuth + Google Workspace, team only). **Don't deploy it publicly with real keys until auth is added.**

## Run it

```bash
cd session-viewer
npm install
npm run dev          # http://localhost:3000
```

With no `S3_BUCKET` set, the app runs on **generated demo data**: 3 robots and 9 sessions, one "recording now" and two interrupted. IMU chunks are generated on request, so the IMU download works. Video and LiDAR chunks are listed but have no content.

To use the real bucket, copy `.env.example` to `.env.local` and fill in the `webapp-reader` keys.

## S3 layout it reads

This is the layout `cloud_sync` on the robot already writes:

```
arnobot-saibya-data/
  <robot_id>/sessions/<session_id>/
    session.json                          metadata (status, started_at, ended_at, stop_reason, counts)
    video/<cam>/*.ts                      DVR MPEG-TS segments overlapping the session
    sensors/lidar/20260924_134701.npz     LiDAR scan chunks
    sensors/imu/20260924_134701.csv.gz    IMU sample chunks
  <robot_id>/_selftest/...                ignored
```

- **Chunk names** are the chunk's start time in **robot local time** (`YYYYMMDD_HHMMSS`, `ROBOT_UTC_OFFSET`, default `+05:30`). Names ending in `Z` are read as UTC. A video segment whose name has no timestamp is still downloadable but can't be placed on the player timeline.
- **Status:** `session.json` with `ended_at` set, or a `status` other than RECORDING/ACTIVE/RUNNING → closed. Otherwise the session is recording if something was uploaded in the last `INTERRUPTED_AFTER_MINUTES` minutes, and interrupted if not.
- **Robots** are the top-level prefixes (or `ROBOT_IDS`). The app only needs `s3:ListBucket` and `s3:GetObject`.
- `*.part` and `*.tmp` files are ignored.

## Sensor formats

```
sensors/imu/*.csv.gz   t_unix, ax, ay, az, gx, gy, gz, mx, my, mz, roll, pitch, yaw, yaw_raw
sensors/lidar/*.npz    t float64[S] (unix), offsets int64[S+1], points float32[N,3] (angle_deg body 0=front CW, range_m, quality)
```

Scan `i` of a LiDAR chunk is `points[offsets[i]:offsets[i+1]]`, taken at `t[i]`:

```python
import numpy as np
z = np.load("20260924_134701.npz")
for i, t in enumerate(z["t"]):
    scan = z["points"][z["offsets"][i]:z["offsets"][i + 1]]
```

## Video playback

Each camera plays through hls.js. `/api/robots/<robot>/sessions/<session>/cameras/<cam>/playlist` builds an HLS VOD playlist over the chunks. Every file URL the app hands out (player segments and downloads) points at `/api/.../object/<path>`, which redirects to a freshly presigned S3 URL. The video comes straight from S3 and never goes through the web app, and a link can't expire while a page is open.

- **CORS:** the bucket must allow `GET`/`HEAD` from the app origin (Step 3 in the setup doc). Add the Vercel URL once it exists.
- **Codec:** browsers play H.264 in `.ts` everywhere. If the main stream (101) is **H.265**, only Safari and some Edge/Chrome builds with hardware HEVC can play it. The player then shows a codec message, and the chunk can still be downloaded. Check the camera's codec before relying on browser playback.

## Downloads

| What | File | How it's built |
|---|---|---|
| One camera | `<robot>_<session>_cam1.ts` | The camera's `.ts` chunks joined in order. MPEG-TS concatenates cleanly, so it's one normal video (VLC, Windows Media Player). |
| IMU | `<robot>_<session>_imu.csv` | The `.csv.gz` chunks decompressed and joined in order, with one header row. |
| LiDAR | `<robot>_<session>_lidar.zip` | The `.npz` chunks as they are (each one is self-contained). |
| Whole session | `<robot>_<session>.zip` | `<cam>.ts` per camera, `imu.csv`, `lidar/*.npz`, `session.json` |

In Chrome and Edge the file streams to disk through the save dialog, so multi-GB videos are fine. Other browsers build it in memory and warn above 2 GB. A missing chunk is skipped, and the ZIP then lists it in `MISSING_FILES.txt`.

An `.mp4` instead of `.ts` would need an ffmpeg remux step (on the Jetson at session end, or in the cloud), which the v2 design leaves out.

## Other behaviour

- **Live sessions:** pages that show a recording session refresh every 30 s. The players take in new chunks when paused, so playback is never interrupted.
- **Caching:** closed sessions never change, so their S3 listing and session.json stay in server memory for 30 minutes. Open sessions are always listed fresh.
- **Share a moment:** "Copy link to this moment" gives a URL with `?t=20260923T090512Z` that opens the session at that time.
- **Snapshot / fullscreen** on each camera tile. The snapshot saves the current frame as PNG.
- **`/api/health`** checks S3 access and explains the usual failures (bad key, missing permission, wrong bucket or region). The error page shows its result.

## Folder structure

```
session-viewer/
  src/
    app/
      page.tsx                             Robots overview (bot-wise)
      robots/[robotId]/page.tsx            Sessions of one robot, status filter
      robots/[robotId]/sessions/[sessionId]/page.tsx   Player + files + session.json
      data/page.tsx                        Data-wise browser (camera / LiDAR + IMU)
      api/robots/[robotId]/sessions/[sessionId]/
        files/route.ts                     File list with download URLs (?kind= &camera= &sensor= &download=1)
        object/[...path]/route.ts          Redirect to a fresh presigned S3 URL
        cameras/[camera]/playlist/route.ts HLS playlist over the .ts chunks
      api/health/route.ts                  S3 access check with a plain-language hint
      api/demo/object/route.ts             Stands in for S3 in demo mode
    components/
      player/                              SessionPlayer, CameraView (hls.js), Timeline, useClock
      DownloadButton.tsx  FileList.tsx  SessionTable.tsx  ui.tsx
    lib/
      archive.ts        sessions, status, stats (all derived from S3 listings + session.json)
      downloads.ts      join video chunks, join IMU CSV, LiDAR ZIP, session ZIP, save to disk (browser)
      keys.ts           S3 key layout and chunk-name parsing
      storage/          s3.ts (AWS SDK), demo.ts (generated data)
      config.ts  types.ts  format.ts
```

## Deploying to Vercel (later)

Set the root directory to `web`, then add `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` (Vercel reserves the `AWS_*` names, which is why these use `S3_*`). Add auth before sharing the URL.
