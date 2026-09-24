import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { demoMode } from "@/lib/config";
import { NavLink } from "@/components/NavLink";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Saibya Archive", template: "%s · Saibya Archive" },
  description: "Recorded camera, LiDAR and IMU sessions from the Saibya robots",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="sticky top-0 z-20 border-b border-border bg-panel/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-on-accent">SA</span>
              <span>Saibya Archive</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/" match={["/", "/robots"]}>Robots</NavLink>
              <NavLink href="/data" match={["/data"]}>Data</NavLink>
            </nav>
            {demoMode && (
              <div className="ml-auto text-xs text-muted">
                <span className="rounded-full bg-warn-soft px-2.5 py-1 font-medium text-warn" title="Set S3_BUCKET in .env.local to read the real archive">
                  Demo data
                </span>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
