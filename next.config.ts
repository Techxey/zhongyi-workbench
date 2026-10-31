import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 本机版打包：产出 .next/standalone 独立 server.js（自带最小 node_modules）
  output: "standalone",
  experimental: {
    // Server Actions body limit: CSV import paths may grow later.
    serverActions: { bodySizeLimit: "6mb" },
  },
  // Prisma 的查询引擎是运行期按文件路径加载的二进制，Next 的静态追踪有时会漏掉，
  // 显式带上，避免打包后报 "Query engine library for current platform could not be found"。
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**",
      "./node_modules/.pnpm/@prisma+client*/node_modules/@prisma/client/**",
    ],
  },
};

export default nextConfig;
