import type { NextConfig } from "next";
import { apiUrl } from "./src/lib/apiUrl";

const nextConfig: NextConfig = {
  // pin the project root (a package.json higher up the tree would otherwise be picked)
  turbopack: { root: __dirname },
  // Everything under /api is the Server's: file lists, video (HLS playlists and segments),
  // downloads and /api/health. Proxying keeps the browser on this origin, so the Server
  // needs no CORS and the relative URLs it returns work as they are.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
