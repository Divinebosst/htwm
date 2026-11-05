import type { NextConfig } from "next";

// Where the Django backend runs. The browser never talks to Django directly:
// requests to /api/* and /media/* on this site are passed through to it.
const API_URL = (process.env.DJANGO_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/media/:path*", destination: `${API_URL}/media/:path*` },
    ];
  },
};

export default nextConfig;
