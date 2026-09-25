import type { DataType, SessionStatus } from "./types";

/** The /data page's filters. They live in the URL so a filtered view can be bookmarked or shared. */
/** What the /data page lists and downloads: one stream type, or whole sessions. */
export type DataView = DataType | "all";

export interface Filters {
  type: DataView;
  q: string;
  robot: string;
  cam: string;
  status: "" | SessionStatus;
  from: string;
  to: string;
  sort: "newest" | "oldest" | "longest" | "largest";
}

export const DEFAULT_FILTERS: Filters = { type: "all", q: "", robot: "", cam: "", status: "", from: "", to: "", sort: "newest" };

export function parseFilters(p: Record<string, string | string[] | undefined>): Filters {
  const f = { ...DEFAULT_FILTERS };
  for (const k of Object.keys(DEFAULT_FILTERS) as Array<keyof Filters>) {
    const v = p[k];
    if (typeof v === "string" && v) (f as Record<string, string>)[k] = v;
  }
  if (!["all", "camera", "sensors"].includes(f.type)) f.type = "all";
  if (!["", "closed", "active", "interrupted"].includes(f.status)) f.status = "";
  if (!["newest", "oldest", "longest", "largest"].includes(f.sort)) f.sort = "newest";
  return f;
}
