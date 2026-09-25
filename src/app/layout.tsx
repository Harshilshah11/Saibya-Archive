import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { getInfo } from "@/lib/api";
import { NavLink } from "@/components/NavLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Saibya Archive", template: "%s · Saibya Archive" },
  description: "Recorded camera, LiDAR and IMU sessions from the Saibya robots",
  applicationName: "Saibya Archive",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111318" },
  ],
};

// Applies a theme pinned with the header toggle before first paint, so it never flashes.
// The browser-chrome colour is synced once the <meta name="theme-color"> tags exist.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // the badge is optional: a Server that is down must not take the whole shell with it
  const demoMode = (await getInfo().catch(() => null))?.mode === "demo";
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <header className="sticky top-0 z-20 border-b border-border bg-panel/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-3 px-6 sm:gap-5">
            <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Saibya Archive home">
              <span className="brand-mark h-9 sm:hidden" aria-hidden />
              <span className="brand-logo hidden h-8 sm:inline-block" aria-hidden />
              <span className="hidden h-7 w-px bg-border sm:block" aria-hidden />
              <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Saibya Archive</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/" match={["/", "/robots"]}>Robots</NavLink>
              <NavLink href="/data" match={["/data"]}>Data</NavLink>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              {demoMode && (
                <span
                  className="hidden rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn sm:inline"
                  title="The Server has no S3 bucket configured and serves generated data"
                >
                  Demo data
                </span>
              )}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-screen-2xl flex-1 px-6 py-6">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-2 px-6 py-4 text-xs text-faint">
            <span className="brand-mark h-5" aria-hidden />
            <span>Arnobot · Saibya session archive</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
