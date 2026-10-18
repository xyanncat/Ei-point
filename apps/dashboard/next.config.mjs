/** @type {import('next').NextConfig} */
import { fileURLToPath } from "node:url";
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === 'production' ? '.next-production' : '.next'),
  output: process.env.NEXT_STANDALONE === "true" ? "standalone" : undefined,
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  async rewrites() {
    const base = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
    return [{ source: "/api/:path*", destination: `${base}/api/:path*` }];
  },
  async redirects() {
    // Suggested global entrypoints map deliberately onto the System tabs.
    return [
      { source: "/system", destination: "/dashboard/system", permanent: false },
      { source: "/system/overview", destination: "/dashboard/system", permanent: false },
      { source: "/system/guilds", destination: "/dashboard/system", permanent: false },
      { source: "/system/integrations", destination: "/dashboard/system/integrations", permanent: false },
      { source: "/system/secrets", destination: "/dashboard/system/vault", permanent: false },
      { source: "/system/backups", destination: "/dashboard/system/backups", permanent: false },
      { source: "/system/:path*", destination: "/dashboard/system", permanent: false },
    ];
  },
};

export default nextConfig;
