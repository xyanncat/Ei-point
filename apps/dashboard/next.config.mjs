/** @type {import('next').NextConfig} */
import { fileURLToPath } from "node:url";
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === 'production' ? '.next-production' : '.next'),
  output: process.env.NEXT_STANDALONE === "true" ? "standalone" : undefined,
  poweredByHeader: false,
  experimental: {
    outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  },
  async rewrites() {
    const base = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3001";
    return [{ source: "/api/:path*", destination: `${base}/api/:path*` }];
  },
};

export default nextConfig;
