"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type Layout = "grid" | "focus" | "single";

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
  // without a shared ?t=, open at the first recorded frame rather than on a blank lead-in
  const firstFrame = Math.min(...cameras.flatMap((c) => c.segments.map((s) => s.start)));
  const clock = useClock(start, end, initialTime ?? (Number.isFinite(firstFrame) ? firstFrame : start));
  const consoleRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<Layout>("grid");
  const [selected, setSelected] = useState(cameras[0]?.name ?? "");
  const [fullscreen, setFullscreen] = useState(false);
  const lanes: Lane[] = useMemo(
    () => cameras.map((c) => ({ label: c.name, ranges: coverage(c.segments) })),
    [cameras],
  );
  const multi = cameras.length > 1;
  const effective: Layout = multi ? layout : "single";

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else consoleRef.current?.requestFullscreen().catch(() => {});
  }

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === consoleRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // 1-9 show one camera, G grid, V focus view, F fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      const n = Number(e.key);
      if (n >= 1 && n <= cameras.length) {
        setSelected(cameras[n - 1].name);
        setLayout((l) => (l === "grid" ? "single" : l));
      } else if (e.key === "g" || e.key === "0") setLayout("grid");
      else if (e.key === "v") setLayout("focus");
      else if (e.key === "f") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameras]);

  // Tiles keep one parent and a stable key across layouts, so switching never reloads a stream.
  const cols = cameras.length <= 1 ? 1 : cameras.length <= 4 ? 2 : 3;
  const others = cameras.filter((c) => c.name !== selected);
  const wallStyle: React.CSSProperties =
    effective === "focus"
      ? { gridTemplateColumns: "3fr 1fr", gridTemplateRows: `repeat(${Math.max(1, others.length)}, minmax(0, 1fr))` }
      : effective === "grid"
        ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
        : {};
  // cap the wall's width by its aspect (grid and single 16:9, focus 64:27) so it and the controls fit one screen
  const fit =
    effective === "focus"
      ? fullscreen ? "max-w-[calc((100dvh-10rem)*64/27)]" : "lg:max-w-[calc((100dvh-25rem)*64/27)]"
      : fullscreen ? "max-w-[calc((100dvh-10rem)*16/9)]" : "lg:max-w-[calc((100dvh-25rem)*16/9)]";

  return (
    <section
      ref={consoleRef}
      className={`overflow-hidden border border-border bg-[#0c0d10] text-white shadow-card ${fullscreen ? "flex h-full flex-col" : "rounded-xl"}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-white/80 uppercase">Cameras</h2>
        <span className="text-xs text-white/40">
          {demo ? "demo: no video content" : `${cameras.length} camera${cameras.length === 1 ? "" : "s"} · main stream 101`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {multi && (
            <>
              <Segmented
                value={layout}
                onChange={setLayout}
                options={[
                  { value: "grid", label: `${cols}×${Math.ceil(cameras.length / cols)}`, title: "All cameras (G)", icon: <GridIcon /> },
                  { value: "focus", label: "Focus", title: "One large, the rest beside it (V)", icon: <FocusIcon /> },
                  { value: "single", label: "Single", title: "One camera (1–9)", icon: <SingleIcon /> },
                ]}
              />
              {effective !== "grid" && (
                <div className="hidden items-center gap-1 sm:flex">
                  {cameras.map((c, i) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setSelected(c.name)}
                      title={`Show ${c.name} (${i + 1})`}
                      aria-pressed={c.name === selected}
                      className={`rounded px-2 py-1 font-mono text-[11px] ${
                        c.name === selected ? "bg-white/15 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            title={fullscreen ? "Exit fullscreen (F)" : "Fullscreen wall (F)"}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen camera wall"}
            className="grid h-7 w-7 place-items-center rounded text-white/60 hover:bg-white/10 hover:text-white"
          >
            <FullscreenIcon exit={fullscreen} />
          </button>
        </div>
      </div>

      <div className={`bg-black ${fullscreen ? "grid min-h-0 flex-1 place-items-center" : ""}`}>
        {cameras.length === 0 ? (
          <div className="grid aspect-video place-items-center rounded-md bg-white/5 text-sm text-white/50">No camera data in this session</div>
        ) : (
          <div className={`mx-auto grid w-full gap-px bg-white/10 ${fit}`} style={wallStyle}>
            {cameras.map((c, i) => {
              const isSel = c.name === selected;
              const hidden = effective === "single" && !isSel;
              const main = effective === "focus" && isSel;
              const place: React.CSSProperties =
                effective === "focus"
                  ? main
                    ? { gridColumn: 1, gridRow: "1 / -1" }
                    : { gridColumn: 2, gridRow: others.indexOf(c) + 1 }
                  : {};
              return (
                <CameraView
                  key={c.name}
                  camera={c.name}
                  index={i}
                  segments={c.segments}
                  playlistUrl={`${apiBase}/cameras/${c.name}/playlist`}
                  time={clock.time}
                  playing={clock.playing}
                  rate={clock.rate}
                  demo={demo}
                  hidden={hidden}
                  compact={effective === "focus" && !main}
                  fill={main}
                  style={place}
                  onSelect={
                    multi
                      ? () => {
                          if (effective === "focus") setSelected(c.name);
                          else if (effective === "grid") {
                            setSelected(c.name);
                            setLayout("single");
                          } else setLayout("grid");
                        }
                      : undefined
                  }
                  selectHint={effective === "single" ? "Back to all cameras" : effective === "focus" ? "Make this the large view" : "Show only this camera"}
                />
              );
            })}
          </div>
        )}
      </div>

      <Timeline clock={clock} start={start} end={end} lanes={lanes} />
    </section>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; title: string; icon: React.ReactNode }>;
}) {
  return (
    <div className="flex rounded border border-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          title={o.title}
          aria-label={o.title}
          aria-pressed={o.value === value}
          className={`flex items-center gap-1.5 px-2 py-1 text-xs first:rounded-l last:rounded-r ${
            o.value === value ? "bg-white/10 text-white" : "text-white/45 hover:text-white"
          }`}
        >
          {o.icon}
          <span className="hidden md:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const icon = { width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor", strokeWidth: 1.3 } as const;
function GridIcon() {
  return (
    <svg {...icon}>
      <rect x="1.5" y="2" width="4.8" height="4.3" rx="0.8" />
      <rect x="7.7" y="2" width="4.8" height="4.3" rx="0.8" />
      <rect x="1.5" y="7.7" width="4.8" height="4.3" rx="0.8" />
      <rect x="7.7" y="7.7" width="4.8" height="4.3" rx="0.8" />
    </svg>
  );
}
function FocusIcon() {
  return (
    <svg {...icon}>
      <rect x="1.5" y="2" width="7.5" height="10" rx="0.8" />
      <rect x="10.2" y="2" width="2.3" height="2.6" rx="0.5" />
      <rect x="10.2" y="5.7" width="2.3" height="2.6" rx="0.5" />
      <rect x="10.2" y="9.4" width="2.3" height="2.6" rx="0.5" />
    </svg>
  );
}
function SingleIcon() {
  return (
    <svg {...icon}>
      <rect x="1.5" y="2" width="11" height="10" rx="0.8" />
    </svg>
  );
}
function FullscreenIcon({ exit }: { exit: boolean }) {
  return exit ? (
    <svg {...icon}>
      <path d="M5 1.5V5H1.5M9 1.5V5h3.5M5 12.5V9H1.5M9 12.5V9h3.5" />
    </svg>
  ) : (
    <svg {...icon}>
      <path d="M1.5 5V1.5H5M12.5 5V1.5H9M1.5 9v3.5H5M12.5 9v3.5H9" />
    </svg>
  );
}
