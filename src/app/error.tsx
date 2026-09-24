"use client";

import { useEffect, useState } from "react";

type Health = { ok: boolean; hint?: string; error?: string };

// Page-level error. Production builds hide server error messages, so the S3 diagnosis
// comes from /api/health.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    console.error(error);
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false, hint: "The app server isn't responding." }));
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16">
      <h1 className="text-xl font-semibold">Couldn&apos;t read the archive</h1>
      {health && !health.ok && (
        <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          {health.hint} {health.error && <span className="font-mono text-xs">({health.error})</span>}
        </p>
      )}
      {health?.ok && <p className="mt-3 text-sm text-muted">S3 is reachable, so this was a one-off error. Try again.</p>}
      <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-panel p-3 font-mono text-xs text-muted">
        {error.message || "Unknown error"}
        {error.digest && `\ndigest: ${error.digest}`}
      </pre>
      <button type="button" onClick={reset} className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent">
        Try again
      </button>
    </div>
  );
}
