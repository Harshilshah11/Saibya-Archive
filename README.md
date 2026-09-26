# Saibya Archive: web app

The team-facing viewer for recorded robot sessions: camera video, LiDAR and IMU from the Saibya robots. It is **UI only**: no AWS keys, no database. Every piece of data comes from the Server's JSON API.

| Branch | What | Runs on |
|---|---|---|
| `main` (this) | Web app: pages, player, downloads | Locally, `npm run dev` |
| `server` | API: robot uploads, Postgres index, S3 access | EC2 `43.204.46.19` (see the `server` branch README) |

- **By robot:** robots → sessions (recording / closed / interrupted) → the cameras playing in sync, plus downloads.
- **By data type** (`/data`): every session across every robot, searchable and filterable, downloadable by stream.
- **One file per stream:** the robot uploads short chunks; the browser joins them into one video per camera, one IMU CSV and one LiDAR `.npz`.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000, reading the EC2 Server
```

To use another Server (e.g. one running locally on port 3100), copy `.env.example` to `.env.local` and set `API_URL`, then restart `npm run dev`. When `API_URL` points at localhost and nothing is listening there, `npm run dev` also starts the Server from `../server` (a checkout of the `server` branch; override the path with `SERVER_DIR`), so both run in one terminal.

## How it talks to the Server

- **Pages** (server components) fetch JSON from `API_URL` through `src/lib/api.ts`: `/api/robots`, `/api/robots/:robot`, `/api/robots/:robot/sessions/:session`, `/api/data`, `/api/info`. Always live (`no-store`), never cached at build.
- **The browser** only ever calls this app's own origin. `next.config.ts` proxies every `/api/*` request to the Server: HLS playlists and video segments (Range requests pass through, so seeking works), file lists, downloads and `/api/health`. So the Server needs no CORS, and the relative `/api/...` URLs it returns work as they are.
- **Server down:** the header still renders and the page shows "Couldn't read the archive" with the Server's `/api/health` hint (or "isn't responding").

## Sensor formats

```
sensors/imu/*.csv.gz   t_unix, ax, ay, az, gx, gy, gz, mx, my, mz, roll, pitch, yaw, yaw_raw
sensors/lidar/*.npz    t float64[S] (unix), offsets int64[S+1], points float32[N,3] (angle_deg body 0=front CW, range_m, quality)
```

Scan `i` of a LiDAR file is `points[offsets[i]:offsets[i+1]]`, taken at `t[i]`:

```python
import numpy as np
z = np.load("saibya02_20260924_134701_lidar.npz")
for i, t in enumerate(z["t"]):
    scan = z["points"][z["offsets"][i]:z["offsets"][i + 1]]
```

## Video playback

Each camera plays through hls.js from the Server's `/api/.../cameras/<cam>/playlist`, an HLS VOD playlist over the camera's `.ts` chunks.

- **Codec:** browsers play H.264 in `.ts` everywhere. If a camera records **H.265**, only Safari and some Edge/Chrome builds with hardware HEVC can play it. The player then shows a codec message, and the video can still be downloaded.

## Downloads

Built in the browser (`src/lib/downloads.ts`) from the session's chunks:

| What | File | How it's built |
|---|---|---|
| One camera | `<robot>_<session>_cam1.ts` | The camera's `.ts` chunks joined in order. MPEG-TS concatenates cleanly, so it's one normal video (VLC, Windows Media Player). |
| IMU | `<robot>_<session>_imu.csv` | The `.csv.gz` chunks decompressed and joined, with one header row. |
| LiDAR | `<robot>_<session>_lidar.npz` | The `.npz` chunks merged into one (`t`, rebased `offsets`, `points`); `numpy.load` reads it. |
| Whole session | `<robot>_<session>.zip` | `<cam>.ts` per camera, `imu.csv`, `lidar.npz`, `session.json` |

In Chrome and Edge the file streams to disk through the save dialog, so multi-GB videos are fine. Other browsers build it in memory and warn above 2 GB. A missing chunk is skipped, and the ZIP lists it in `MISSING_FILES.txt`.

## Other behaviour

- **Live sessions:** pages that show a recording session refresh every 30 s. The players take in new chunks when paused, so playback is never interrupted.
- **Share a moment:** "Copy link to this moment" gives a URL with `?t=20260923T090512Z` that opens the session at that time.
- **Snapshot / fullscreen** on each camera tile. The snapshot saves the current frame as PNG.
- **Demo badge:** shown when the Server has no bucket configured and serves generated data.

## Folder structure

```
src/
  app/
    page.tsx                                        Robots overview
    robots/[robotId]/page.tsx                       Sessions of one robot: status filter, search, day
    robots/[robotId]/sessions/[sessionId]/page.tsx  Player + downloads + raw files + session.json
    data/page.tsx                                   Every session, by data type
    layout.tsx  error.tsx  loading.tsx  not-found.tsx
  components/
    player/          SessionPlayer, CameraView (hls.js), Timeline, useClock
    DataBrowser.tsx  DownloadButton.tsx  FileList.tsx  SessionTable.tsx  RobotAlerts.tsx  ui.tsx …
  lib/
    api.ts           the Server's JSON API (server-only)
    apiUrl.ts        API_URL, shared with next.config.ts
    downloads.ts     join video / IMU / LiDAR chunks, session ZIP, save to disk (browser)
    npz.ts           read and write .npz / .npy
    types.ts         data and API response types (same file on the server branch)
    keys.ts  format.ts  dataFilters.ts
next.config.ts       /api/* proxy to the Server
```

There is no auth yet (planned: team-only sign-in). The Server's read API is open to anyone who can reach it.
