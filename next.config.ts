import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep Turbopack scoped to this app when parent directories contain unrelated lockfiles.
  // Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
  turbopack: { root: process.cwd() },
};

export default nextConfig;
