import type { NextConfig } from "next";

/** 빌드(배포)마다 달라지는 식별자 — 클라이언트 번들과 서버(/api/version)에 같은 값이 박혀 새 배포 감지에 사용 */
const BUILD_ID = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? `local-${Date.now()}`;

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // 서비스 워커는 항상 최신본을 받도록 캐시 금지
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
