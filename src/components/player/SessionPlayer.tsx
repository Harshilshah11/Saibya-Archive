"use client";

import { useMemo, useState } from "react";
import type { CameraSegment } from "@/lib/types";
import { CameraView } from "./CameraView";
import { Timeline, type Lane } from "./Timeline";
import { useClock } from "./useClock";

export interface PlayerProps {
  apiBase: string;
  start: number;
  end: number;
  cameras: Array<{ name: string; segments: CameraSegment[] }>;
  demo: boolean;
  /** epoch ms to open at (from a shared ?t= link) */
  initialTime?: number;
}

function coverage(items: CameraSegment[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const it of items) {
    const a = it.start, b = it.start + it.duration * 1000;
    const last = out[out.length - 1];
    if (last && a - last[1] < 2000) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The session's cameras as one continuous video each, kept in sync on one timeline. */
export function SessionPlayer({ apiBase, start, end, cameras, demo, initialTime }: PlayerProps) {
  const clock = useClock(start, end, initialTime);
  const [expanded, setExpanded] = useState<string | null>(null);
  const lanes: Lane[] = useMemo(() => cameras.map((c) => ({ label: c.name, ranges: coverage(c.segments) })), [cameras]);
  const shown = expanded ? cameras.filter((c) => c.name === expanded) : cameras;

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-border bg-panel p-3 shadow-card">
        <div className="mb-3 flex items-baseline gap-2 px-1">
          <h2 className="text-sm font-semibold">Cameras</h2>
          <span className="text-xs text-faint">{demo ? "demo: no video content" : `${cameras.length} cameras, main stream 101`}</span>
        </div>
        {cameras.length === 0 ? (
          <div className="grid aspect-video place-items-center rounded-md bg-panel-2 text-sm text-muted">No camera data in this session</div>
        ) : (
          <div className={`grid gap-2 ${shown.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {shown.map((c) => (
              <CameraView
                key={c.name}
                camera={c.name}
                segments={c.segments}
                playlistUrl={`${apiBase}/cameras/${c.name}/playlist`}
                time={clock.time}
                playing={clock.playing}
                rate={clock.rate}
                demo={demo}
                expanded={expanded === c.name}
                onExpand={() => setExpanded(expanded === c.name ? null : c.name)}
              />
            ))}
          </div>
        )}
      </section>
      <Timeline clock={clock} start={start} end={end} lanes={lanes} />
    </div>
  );
}
