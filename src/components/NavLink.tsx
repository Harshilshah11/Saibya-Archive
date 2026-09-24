"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, match, children }: { href: string; match: string[]; children: React.ReactNode }) {
  const path = usePathname();
  const active = match.some((m) => (m === "/" ? path === "/" : path.startsWith(m)));
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 transition-colors ${
        active ? "bg-panel-2 font-medium text-text" : "text-muted hover:text-text"
      }`}
    >
      {children}
    </Link>
  );
}
