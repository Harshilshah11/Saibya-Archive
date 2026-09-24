import { formatBytes, formatClock } from "@/lib/format";
import type { SignedFile } from "@/lib/types";

/** Session files grouped by stream, each with a presigned download link. */
export function FileList({ files }: { files: SignedFile[] }) {
  const groups = new Map<string, SignedFile[]>();
  for (const f of files) {
    const g = f.kind === "camera" ? `video/${f.camera}` : f.kind === "sensors" ? `sensors/${f.sensor}` : "session metadata";
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div className="divide-y divide-border">
      {order.map((g) => {
        const list = groups.get(g)!;
        return (
          <details key={g} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm hover:bg-panel-2">
              <span className="text-faint transition-transform group-open:rotate-90">▸</span>
              <span className="font-mono font-medium">{g}</span>
              <span className="tabular ml-auto text-xs text-muted">
                {list.length} files · {formatBytes(list.reduce((n, f) => n + f.size, 0))}
              </span>
            </summary>
            <ul className="tabular max-h-80 overflow-y-auto px-4 pb-2 text-xs">
              {list.map((f) => (
                <li key={f.key} className="flex items-center gap-3 border-t border-border py-1.5 first:border-0">
                  <span className="font-mono">{f.name}</span>
                  {f.start !== undefined && <span className="text-faint">{formatClock(f.start)} UTC</span>}
                  <span className="ml-auto text-muted">{formatBytes(f.size)}</span>
                  <a href={f.url} className="text-accent hover:underline">
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function rank(g: string) {
  return g.startsWith("video") ? 0 : g.startsWith("sensors") ? 1 : 2;
}
