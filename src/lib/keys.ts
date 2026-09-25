// Session file names and chunk times, as the Server (server branch, lib/keys.ts) defines them.

/** Session metadata written by the robot at start and rewritten when the session ends. */
export const SESSION_FILE = "session.json";

/**
 * Chunk name -> epoch ms. Two forms:
 *   "20260923T090000Z"  UTC (used in app URLs, e.g. ?t=)
 *   "20260924_134701"   robot local time, offset by `localOffsetMin` (robot uploads)
 */
export function parseChunkTime(stem: string, localOffsetMin = 0): number | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})[T_-]?(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?(Z)?/.exec(stem);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, ms, z] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms ? +ms.padEnd(3, "0") : 0);
  return z ? utc : utc - localOffsetMin * 60_000;
}

/** epoch ms -> "20260923T090000Z" */
export function formatChunkTime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** cam1, cam2, … cam10 in numeric order; other names alphabetically after them. */
export function sortCameras(cams: Iterable<string>): string[] {
  const num = (c: string) => (/^cam(\d+)$/.exec(c) ? Number(c.slice(3)) : Infinity);
  return [...cams].sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}
