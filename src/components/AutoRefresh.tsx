"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches the page's server data while something is still recording. Pauses in background tabs. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={`Refreshes every ${seconds} s while recording`}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" /> Live, updates every {seconds} s
    </span>
  );
}
