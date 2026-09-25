import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { apiUrl } from "./apiUrl";
import type { ApiInfo, DataIndex, RobotDetail, RobotSummary, SessionDetail } from "./types";

// The Server's JSON API (server branch, on EC2), read by the pages. The browser never calls
// these URLs directly: its /api/* requests (files, video, downloads) go through the proxy in
// next.config.ts.

async function get<T>(path: string): Promise<T | null> {
  await connection(); // archive data is always live: render at request time, never at build
  let res: Response;
  try {
    res = await fetch(apiUrl + path, { cache: "no-store" });
  } catch (err) {
    throw new Error(`Can't reach the Server at ${apiUrl} (${(err as Error).message}). Is it running?`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Server ${path} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const seg = encodeURIComponent;

export const getInfo = cache(() => get<ApiInfo>("/api/info"));

export const listRobots = cache(async () => (await get<{ robots: RobotSummary[] }>("/api/robots"))?.robots ?? []);

/** null for an unknown robot */
export const getRobot = cache((robotId: string) => get<RobotDetail>(`/api/robots/${seg(robotId)}`));

/** null for an unknown session */
export const getSession = cache((robotId: string, sessionId: string) =>
  get<SessionDetail>(`/api/robots/${seg(robotId)}/sessions/${seg(sessionId)}`),
);

export const getDataIndex = cache(async () => (await get<DataIndex>("/api/data")) ?? { robots: [], rows: [] });

/** One "now" per request, so every relative time on a page agrees. */
export const requestNow = cache(() => Date.now());
