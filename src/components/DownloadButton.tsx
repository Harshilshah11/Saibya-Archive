"use client";

import { useRef, useState } from "react";
import {
  counter,
  fetchFiles,
  joinedImu,
  joinedVideo,
  lidarZip,
  pickSaveTarget,
  save,
  sessionZip,
} from "@/lib/downloads";
import { formatBytes } from "@/lib/format";

export type DownloadWhat =
  | { type: "session" }
  | { type: "camera"; camera: string }
  | { type: "imu" }
  | { type: "lidar" };

interface Props {
  apiBase: string;
  fileName: string;
  totalBytes: number;
  what: DownloadWhat;
  label: string;
  variant?: "primary" | "secondary";
}

export function DownloadButton({ apiBase, fileName, totalBytes, what, label, variant = "secondary" }: Props) {
  const [progress, setProgress] = useState<{ done: number; file: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run() {
    setMessage(null);
    const target = await pickSaveTarget(fileName);
    if (!target) return; // save dialog cancelled
    if (target === "memory" && totalBytes > 2 * 1024 ** 3) {
      if (!confirm(`This file is about ${formatBytes(totalBytes)}. This browser has to hold it in memory first. Continue?`)) return;
    }

    const abort = new AbortController();
    abortRef.current = abort;
    const add = counter((done, file) => setProgress({ done, file }));
    const missing: string[] = [];
    setProgress({ done: 0, file: "" });

    try {
      const query: Record<string, string> =
        what.type === "camera"
          ? { kind: "camera", camera: what.camera }
          : what.type === "imu" || what.type === "lidar"
            ? { kind: "sensors", sensor: what.type }
            : {};
      const files = await fetchFiles(apiBase, query, abort.signal);
      if (!files.length) throw new Error("No files to download");

      const folder = fileName.replace(/\.zip$/, "");
      const data =
        what.type === "camera"
          ? joinedVideo(files, add, abort.signal, missing)
          : what.type === "imu"
            ? await joinedImu(files, add, abort.signal, missing)
            : what.type === "lidar"
              ? lidarZip(files, folder, add, abort.signal, missing)
              : await sessionZip(files, folder, add, abort.signal, missing);
      await save(target, fileName, data);

      setMessage(missing.length ? `Saved. ${missing.length} chunk(s) were missing and skipped.` : "Saved.");
    } catch (e) {
      setMessage(abort.signal.aborted ? "Cancelled." : `Failed: ${(e as Error).message}`);
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  if (progress) {
    const pct = totalBytes ? Math.min(100, (progress.done / totalBytes) * 100) : 0;
    return (
      <div className="flex w-72 items-center gap-2 text-xs">
        <div className="min-w-0 flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div className="tabular mt-1 truncate text-muted">
            {formatBytes(progress.done)} / {formatBytes(totalBytes)} {progress.file && `· ${progress.file}`}
          </div>
        </div>
        <button type="button" onClick={() => abortRef.current?.abort()} className="rounded border border-border px-2 py-1 hover:bg-panel-2">
          Cancel
        </button>
      </div>
    );
  }

  const style =
    variant === "primary"
      ? "bg-accent text-on-accent hover:opacity-90"
      : "border border-border bg-panel hover:border-accent hover:text-accent";
  return (
    <div className="flex items-center justify-end gap-2">
      {message && <span className="text-xs text-muted">{message}</span>}
      <button type="button" onClick={run} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${style}`}>
        {label} <span className="font-normal opacity-70">· {formatBytes(totalBytes)}</span>
      </button>
    </div>
  );
}
