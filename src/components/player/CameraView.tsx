"use client";

import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { formatChunkTime } from "@/lib/keys";
import type { CameraSegment } from "@/lib/types";

interface Props {
  camera: string;
  segments: CameraSegment[];
  playlistUrl: string;
  time: number;
  playing: boolean;
  rate: number;
  demo: boolean;
  index: number;
  /** kept mounted (so the stream stays loaded) but not shown */
  hidden?: boolean;
  /** small thumbnail tile: fewer overlays */
  compact?: boolean;
  /** fill the grid cell instead of keeping 16:9 */
  fill?: boolean;
  style?: React.CSSProperties;
  onSelect?: () => void;
  selectHint?: string;
}

/** Wall-clock ms -> position in the concatenated HLS timeline, or null inside a recording gap. */
function mediaTimeAt(segments: CameraSegment[], t: number): number | null {
  let offset = 0;
  for (const s of segments) {
    if (t >= s.start && t < s.start + s.duration * 1000) return offset + (t - s.start) / 1000;
    offset += s.duration;
  }
  return null;
}

export function CameraView({
  camera, segments, playlistUrl, time, playing, rate, demo, index, hidden, compact, fill, style, onSelect, selectHint,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);
  // no frame decoded yet: show a loader rather than a blank black tile
  const [loaded, setLoaded] = useState(false);
  const media = mediaTimeAt(segments, time);

  // A recording session keeps adding chunks. Reload the playlist only while paused,
  // so playback is never interrupted by the page's live refresh.
  const [loadedCount, setLoadedCount] = useState(segments.length);
  if (!playing && loadedCount !== segments.length) setLoadedCount(segments.length);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || demo || !loadedCount) return;
    const src = `${playlistUrl}?n=${loadedCount}`;
    let hls: Hls | null = null;
    let cancelled = false;

    (async () => {
      const { default: HlsLib } = await import("hls.js");
      if (cancelled) return;
      if (HlsLib.isSupported()) {
        hls = new HlsLib({ maxBufferLength: 20, backBufferLength: 30 });
        hls.on(HlsLib.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          setError(
            data.details === "bufferAddCodecError" || data.details === "manifestIncompatibleCodecsError"
              ? "This browser can't decode the camera codec (H.265?). Try Safari or Edge, or download the video below."
              : `Playback error: ${data.details}`,
          );
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src; // Safari plays HLS natively
      } else {
        setError("HLS playback isn't supported in this browser.");
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [playlistUrl, demo, loadedCount]);

  // follow the session clock
  useEffect(() => {
    const video = videoRef.current;
    if (!video || demo || error) return;
    if (media === null) {
      if (!video.paused) video.pause();
      return;
    }
    video.playbackRate = rate;
    const drift = Math.abs(video.currentTime - media);
    if (playing) {
      if (drift > 0.75) video.currentTime = media;
      if (video.paused) video.play().catch(() => {});
    } else {
      if (!video.paused) video.pause();
      if (drift > 0.05) video.currentTime = media;
    }
  }, [media, playing, rate, demo, error]);

  function snapshot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${camera}_${formatChunkTime(time)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }, "image/png");
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else boxRef.current?.requestFullscreen().catch(() => {});
  }

  const canPlay = !demo && !error && media !== null;
  const noSignal = !segments.length || media === null;
  const tool =
    "pointer-events-auto grid h-6 w-6 place-items-center rounded-sm bg-black/60 text-white/75 opacity-0 transition-opacity hover:bg-black/80 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100";

  return (
    <div
      ref={boxRef}
      style={style}
      onClick={onSelect}
      title={onSelect ? selectHint : undefined}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect && !hidden ? 0 : undefined}
      aria-label={onSelect ? `${camera}: ${selectHint}` : `${camera} camera`}
      onKeyDown={(e) => {
        if (onSelect && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
      className={`group @container relative overflow-hidden bg-black ${fill ? "min-h-0" : "aspect-video"} ${
        hidden ? "hidden" : ""
      } ${onSelect ? "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" : ""}`}
    >
      {!demo && (
        <video
          ref={videoRef}
          muted
          playsInline
          crossOrigin="anonymous"
          className="absolute inset-0 h-full w-full object-contain"
          onLoadedData={() => setLoaded(true)}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onSeeked={() => setBuffering(false)}
          onLoadedMetadata={(e) => {
            // after a playlist reload, jump back to the playhead
            if (media !== null) e.currentTarget.currentTime = media;
          }}
        />
      )}

      {(demo || error || noSignal) && (
        <div
          className="absolute inset-0 grid place-items-center p-4 text-center"
          style={noSignal ? { background: "#0b0c0f" } : undefined}
        >
          <div>
            {noSignal && (
              <div className="hidden text-[10px] font-medium tracking-[0.15em] text-white/35 uppercase @sm:block">No signal</div>
            )}
            <div className="mt-1 text-[10px] text-white/45 @sm:text-xs">
              {!segments.length
                ? "No video uploaded for this camera"
                : media === null
                  ? "No recording at this time"
                  : error
                    ? error
                    : "Demo mode has no video content. With S3 connected the recording plays here."}
            </div>
          </div>
        </div>
      )}

      {(buffering || !loaded) && canPlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" role="status">
          <div className="h-5 w-5 animate-spin rounded-full border border-white/15 border-t-white/70" />
          <span className={`text-[11px] text-white/50 ${loaded ? "sr-only" : "hidden @xs:block"}`}>{loaded ? "Buffering" : "Loading video…"}</span>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/50 to-transparent px-1.5 pt-1.5 pb-5">
        <span className="rounded-sm bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white/90">
          {camera}
          {!compact && <span className="ml-1.5 text-white/35">{index + 1}</span>}
        </span>
        <span className="mr-auto" />
        {canPlay && !compact && (
          <button type="button" onClick={(e) => (e.stopPropagation(), snapshot())} className={tool} title="Save this frame as PNG" aria-label={`Save a ${camera} snapshot`}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M1.5 4.5h2.2l1-1.7h4.6l1 1.7h2.2v7h-11z" />
              <circle cx="7" cy="7.8" r="2.1" />
            </svg>
          </button>
        )}
        {!compact && (
          <button type="button" onClick={(e) => (e.stopPropagation(), fullscreen())} className={tool} title="Fullscreen this camera" aria-label={`Fullscreen ${camera}`}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M1.5 5V1.5H5M12.5 5V1.5H9M1.5 9v3.5H5M12.5 9v3.5H9" />
            </svg>
          </button>
        )}
      </div>

    </div>
  );
}
