import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Same-origin proxy to FastAPI so session cookies + CSRF work like the old Vite proxy.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://127.0.0.1:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
