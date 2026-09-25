-- Saibya Archive v3: the index of what is in S3. S3 stays the source of truth; every row
-- here can be rebuilt from the bucket with POST /api/admin/reindex.
-- Idempotent: `npm run db:migrate` runs this file as-is on every deploy.

-- One row per physical robot (the top-level S3 prefix, e.g. saibya02).
create table if not exists robots (
  id            text primary key,
  name          text,
  -- sha256 (hex) of the robot's device token; null = the robot cannot ingest
  token_hash    text unique,
  created_at    timestamptz not null default now(),
  -- last heartbeat from cloud_sync and its body (backlog, disk, alerts, current session)
  last_seen_at  timestamptz,
  last_status   jsonb
);

-- A named mission / day that groups sessions (typed by the operator at Start).
create table if not exists trips (
  id          bigserial primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);

-- One row per recording session (operator Start -> Stop).
-- robot_id is the id shown in the app: "saibya02", or "saibya02-sim" for bench simulations.
create table if not exists sessions (
  robot_id     text not null,
  session_id   text not null,
  trip_id      bigint references trips(id) on delete set null,
  -- session.json as last uploaded; the columns below are copied out of it for filtering
  manifest     jsonb,
  status       text,
  started_at   timestamptz,
  ended_at     timestamptz,
  stop_reason  text,
  simulated    boolean not null default false,
  -- _COMPLETE.json is in S3: every file of the session is uploaded
  complete     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (robot_id, session_id)
);
create index if not exists sessions_trip_idx on sessions (trip_id);
create index if not exists sessions_started_idx on sessions (robot_id, started_at desc);

-- One row per object in S3 (video segment, sensor chunk, session.json, logs).
create table if not exists files (
  key          text primary key,
  robot_id     text not null,
  session_id   text not null,
  -- path inside the session folder, e.g. video/cam1/20260924_134701.ts
  name         text not null,
  kind         text not null check (kind in ('camera', 'sensors', 'meta')),
  camera       text,
  sensor       text,
  -- chunk start parsed from the file name; null for meta files
  chunk_start  timestamptz,
  size         bigint not null,
  uploaded_at  timestamptz not null default now(),
  foreign key (robot_id, session_id) references sessions (robot_id, session_id) on delete cascade
);
create index if not exists files_session_idx on files (robot_id, session_id);

-- v4: sha256 (hex) the robot sent with PUT /api/ingest/upload; null for files indexed another way.
alter table files add column if not exists sha256 text;
