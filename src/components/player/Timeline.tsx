"use client";

import { useEffect, useState } from "react";
import { formatChunkTime } from "@/lib/keys";
import { formatClock, formatDuration } from "@/lib/format";
import type { Clock } from "./useClock";

export interface Lane {
  label: string;
  /** covered [start, end] ranges in epoch ms */
  ranges: Array<[number, number]>;
}

const RATES = [0.5, 1, 2, 4, 8];

export function Timeline({ clock, start, end, lanes }: { clock: Clock; start: number; end: number; lanes: Lane[] }) {
  const { time, playing, rate, setRate, seek, toggle } = clock;
  const span = Math.max(1, end - start);
  const pct = (t: number) => `${((t - start) / span) * 100}%`;
  const [copied, setCopied] = useState(false);

  function copyMoment() {
    const url = new URL(window.location.href);
    url.searchParams.set("t", formatChunkTime(time));
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range") return;
      if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seek(time + (e.shiftKey ? 60_000 : 5_000));
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seek(time - (e.shiftKey ? 60_000 : 5_000));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, time]);

  return (
    <div className="rounded-xl border border-border bg-panel px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="grid h-9 w-9 place-items-center rounded-full bg-accent text-on-accent hover:opacity-90"
          aria-label={playing ? "Pause" : "Play"}
          title="Space"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12" rx="1" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11a.8.8 0 0 0 1.2.7l9-5.5a.8.8 0 0 0 0-1.4l-9-5.5A.8.8 0 0 0 3 1.5Z" /></svg>
          )}
        </button>
        <div className="tabular font-mono text-sm">
          <span className="font-semibold">{formatClock(time)}</span>
          <span className="text-faint"> UTC</span>
        </div>
        <div className="tabular text-sm text-muted">
          {formatDuration((time - start) / 1000)} / {formatDuration(span / 1000)}
        </div>
        <button
          type="button"
          onClick={copyMoment}
          className="rounded border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
          title="Copy a link that opens this session at this exact time"
        >
          {copied ? "Link copied" : "Copy link to this moment"}
        </button>
        <div className="ml-auto flex items-center gap-1 text-xs">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRate(r)}
              className={`rounded px-2 py-1 ${r === rate ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-text"}`}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <input
          type="range"
          min={start}
          max={end}
          step={100}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
          aria-label="Session time"
        />
        <div className="mt-1 space-y-1">
          {lanes.map((lane) => (
            <div key={lane.label} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-right font-mono text-[10px] text-faint">{lane.label}</span>
              <div className="relative h-1.5 flex-1 rounded-full bg-panel-2">
                {lane.ranges.map(([a, b], i) => (
                  <div
                    key={i}
                    className="absolute inset-y-0 rounded-full bg-accent/50"
                    style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }}
                  />
                ))}
                <div className="absolute -top-0.5 h-2.5 w-0.5 bg-text" style={{ left: pct(time) }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 text-right text-[10px] text-faint">Space play/pause · ←/→ 5 s · Shift 1 min</div>
      </div>
    </div>
  );
}
