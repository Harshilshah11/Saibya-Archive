"use client";

import { useEffect, useRef, useState } from "react";
import { formatChunkTime } from "@/lib/keys";
import { formatClock, formatDuration } from "@/lib/format";
import type { Clock } from "./useClock";

export interface Lane {
  label: string;
  /** covered [start, end] ranges in epoch ms */
  ranges: Array<[number, number]>;
}

const RATES = [0.5, 1, 2, 4, 8];

/** Evenly spaced clock labels along the track, on round minute/second steps. */
function ticks(start: number, end: number): number[] {
  const span = end - start;
  const steps = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map((s) => s * 1000);
  const step = steps.find((s) => span / s <= 8) ?? 3 * 3600_000;
  const out: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) out.push(t);
  return out;
}

export function Timeline({ clock, start, end, lanes }: { clock: Clock; start: number; end: number; lanes: Lane[] }) {
  const { time, playing, rate, setRate, seek, toggle } = clock;
  const span = Math.max(1, end - start);
  const pct = (t: number) => `${((t - start) / span) * 100}%`;
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function timeAt(clientX: number) {
    const r = trackRef.current!.getBoundingClientRect();
    return start + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span;
  }

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
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      // Space on a focused button or link activates it rather than play/pause
      if (e.code === "Space" && el.closest("button, a, [role=button]")) return;
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

  const btn = "grid h-8 w-8 place-items-center rounded text-white/60 hover:bg-white/10 hover:text-white";
  const marks = ticks(start, end);

  return (
    <div className="border-t border-white/10 bg-[#0c0d10]">
      {/* transport */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.06] px-3 py-2">
        <div className="flex items-center">
          <button type="button" onClick={() => seek(time - 10_000)} className={btn} aria-label="Back 10 seconds" title="Back 10 s">
            <StepIcon back />
          </button>
          <button
            type="button"
            onClick={toggle}
            className="grid h-8 w-8 place-items-center rounded text-white hover:bg-white/10"
            aria-label={playing ? "Pause" : "Play"}
            title="Play / pause (Space)"
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="2" width="2.6" height="10" rx="0.5" /><rect x="8.4" y="2" width="2.6" height="10" rx="0.5" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3.5 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5Z" /></svg>
            )}
          </button>
          <button type="button" onClick={() => seek(time + 10_000)} className={btn} aria-label="Forward 10 seconds" title="Forward 10 s">
            <StepIcon />
          </button>
        </div>
        <div className="tabular font-mono text-[13px] text-white">
          {new Date(time).toISOString().slice(0, 10)} {formatClock(time)}
          <span className="ml-1 text-white/35">UTC</span>
        </div>
        <div className="tabular font-mono text-xs text-white/40">
          {formatDuration((time - start) / 1000)} / {formatDuration(span / 1000)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={copyMoment}
            className="rounded px-2 py-1 text-xs text-white/50 hover:bg-white/10 hover:text-white"
            title="Copy a link that opens this session at this exact time"
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          <div className="flex rounded border border-white/10 text-xs">
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRate(r)}
                className={`tabular px-2 py-1 first:rounded-l last:rounded-r ${r === rate ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}
              >
                {r}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* scrubber: click or drag anywhere on the lanes */}
      <div className="flex gap-3 px-3 pt-2 pb-2.5">
        <div className="w-12 shrink-0 pt-5">
          {lanes.map((lane) => (
            <div key={lane.label} className="flex h-3 items-center justify-end font-mono text-[10px] leading-none text-white/40">
              {lane.label}
            </div>
          ))}
        </div>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Session time"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatClock(time)} UTC`}
          className="relative flex-1 cursor-pointer touch-none select-none"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            seek(timeAt(e.clientX));
          }}
          onPointerMove={(e) => {
            setHover(timeAt(e.clientX));
            if (dragging.current) seek(timeAt(e.clientX));
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          onPointerLeave={() => setHover(null)}
        >
          {/* time ruler */}
          <div className="relative h-5 border-b border-white/10">
            {marks.map((t) => (
              <div key={t} className="absolute bottom-0 h-1.5 w-px bg-white/25" style={{ left: pct(t) }}>
                <span className="tabular absolute bottom-2 hidden -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-white/35 sm:block">
                  {formatClock(t).slice(0, span > 600_000 ? 5 : 8)}
                </span>
              </div>
            ))}
          </div>
          {lanes.map((lane) => (
            <div key={lane.label} className="relative h-3 border-b border-white/[0.05]">
              {lane.ranges.map(([a, b], i) => (
                <div
                  key={i}
                  className="absolute top-[3px] bottom-[3px] bg-[#4a7bd0]/70"
                  style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }}
                />
              ))}
            </div>
          ))}
          {hover !== null && (
            <>
              <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/30" style={{ left: pct(hover) }} />
              <div
                className="tabular pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-sm bg-white px-1 py-px font-mono text-[10px] whitespace-nowrap text-black"
                style={{ left: pct(hover) }}
              >
                {formatClock(hover)}
              </div>
            </>
          )}
          <div className="pointer-events-none absolute top-3 bottom-0 w-px -translate-x-1/2 bg-[#ff4d4d]" style={{ left: pct(time) }}>
            <div className="absolute -top-1 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[5px] border-x-transparent border-t-[#ff4d4d]" />
          </div>
        </div>
      </div>
      <div className="hidden px-3 pb-2 text-right text-[10px] text-white/25 lg:block">
        Space play · ←/→ 5 s · Shift+←/→ 1 min · 1–9 camera · G grid · V focus · F fullscreen
      </div>
    </div>
  );
}

function StepIcon({ back = false }: { back?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={back ? undefined : { transform: "scaleX(-1)" }}>
      <path d="M7 3.2v7.6a.5.5 0 0 1-.8.4L1.6 7.4a.5.5 0 0 1 0-.8l4.6-3.8a.5.5 0 0 1 .8.4Z" />
      <path d="M12.5 3.2v7.6a.5.5 0 0 1-.8.4L7.1 7.4a.5.5 0 0 1 0-.8l4.6-3.8a.5.5 0 0 1 .8.4Z" />
    </svg>
  );
}
