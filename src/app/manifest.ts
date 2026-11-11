import type { MetadataRoute } from "next";

/** PWA: 홈 화면 추가 · standalone(주소창 없는 앱 화면) 실행 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Ordinary Extraordinary",
    short_name: "오디너리엑스트라오디너리",
    description: "주간 일정 · 할 일 · 데일리 노트를 한 화면에서",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#eef1f6",
    theme_color: "#eef1f6",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
