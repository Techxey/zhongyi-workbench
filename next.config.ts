import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Actions body limit: CSV import paths may grow later.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
