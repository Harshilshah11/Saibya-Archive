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
  onExpand?: () => void;
  expanded?: boolean;
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

export function CameraView({ camera, segments, playlistUrl, time, playing, rate, demo, onExpand, expanded }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);
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
  const tool =
    "pointer-events-auto rounded bg-black/50 px-1.5 py-0.5 text-[11px] text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 focus:opacity-100";

  return (
    <div ref={boxRef} className="group relative aspect-video overflow-hidden rounded-md bg-black">
      {!demo && (
        <video
          ref={videoRef}
          muted
          playsInline
          crossOrigin="anonymous"
          className="h-full w-full object-contain"
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onSeeked={() => setBuffering(false)}
          onLoadedMetadata={(e) => {
            // after a playlist reload, jump back to the playhead
            if (media !== null) e.currentTarget.currentTime = media;
          }}
        />
      )}

      {(demo || error || media === null || !segments.length) && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-white/70">
          <div>
            {!segments.length
              ? "No video uploaded for this camera"
              : media === null
                ? "No recording at this time"
                : error
                  ? error
                  : "Demo mode has no video content. With S3 connected the recording plays here."}
          </div>
        </div>
      )}

      {buffering && canPlay && (
        <div className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">buffering…</div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/60 to-transparent px-2 py-1.5">
        <span className="mr-auto rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white">{camera}</span>
        {canPlay && (
          <button type="button" onClick={snapshot} className={tool} title="Save this frame as PNG">
            Snapshot
          </button>
        )}
        <button type="button" onClick={fullscreen} className={tool}>
          Fullscreen
        </button>
        {onExpand && (
          <button type="button" onClick={onExpand} className={tool}>
            {expanded ? "Grid" : "Expand"}
          </button>
        )}
      </div>
    </div>
  );
}
