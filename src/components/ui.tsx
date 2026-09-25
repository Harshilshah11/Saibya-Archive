import Link from "next/link";
import type { SessionStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: SessionStatus }) {
  const styles: Record<SessionStatus, string> = {
    active: "bg-live-soft text-live",
    closed: "bg-ok-soft text-ok",
    interrupted: "bg-warn-soft text-warn",
  };
  const labels: Record<SessionStatus, string> = { active: "Recording", closed: "Closed", interrupted: "Interrupted" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status === "active" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />}
      {labels[status]}
    </span>
  );
}

/** For a stopped session: is everything in S3 yet (cloud_sync's _COMPLETE.json marker)? */
export function UploadBadge({ upload, status }: { upload: "complete" | "uploading" | "unknown"; status: SessionStatus }) {
  if (status !== "closed" || upload === "unknown") return null;
  return upload === "complete" ? (
    <span className="inline-flex items-center rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">All uploaded</span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
      Still uploading
    </span>
  );
}

export function PageHeader({
  title,
  description,
  children,
  mono = false,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** shown next to the title, e.g. the live-refresh indicator */
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={`text-2xl font-semibold tracking-tight ${mono ? "font-mono" : ""}`}>{title}</h1>
        {children}
      </div>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-panel px-4 py-3.5 shadow-card">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-border bg-panel shadow-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Crumbs({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav className="mb-2 flex flex-wrap items-center gap-1.5 text-sm text-muted">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-faint">/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-text">
              {it.label}
            </Link>
          ) : (
            <span className="font-mono text-text">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Pill({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active ? "border-accent/40 bg-accent-soft font-medium text-accent" : "border-border bg-panel text-muted hover:border-faint hover:text-text"
      }`}
    >
      {children}
    </Link>
  );
}
