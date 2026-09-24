"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Session playback clock in wall-clock epoch ms. Every camera follows it. */
export function useClock(start: number, end: number, initial = start) {
  const [time, setTime] = useState(() => Math.max(start, Math.min(end, initial)));
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const timeRef = useRef(time);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(end, timeRef.current + (now - last) * rate);
      last = now;
      timeRef.current = next;
      setTime(next);
      if (next >= end) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, end]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(start, Math.min(end, t));
      timeRef.current = clamped;
      setTime(clamped);
    },
    [start, end],
  );

  const toggle = useCallback(() => {
    if (timeRef.current >= end) seek(start);
    setPlaying((p) => !p);
  }, [end, start, seek]);

  return { time, playing, rate, setRate, seek, toggle, setPlaying };
}

export type Clock = ReturnType<typeof useClock>;
