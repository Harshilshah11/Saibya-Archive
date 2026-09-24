import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pin the project root (a package.json higher up the tree would otherwise be picked)
  turbopack: { root: __dirname },
};

export default nextConfig;
