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
    // 아이콘을 바꿀 때마다 ?v= 를 올려야 설치된 PWA(Android WebAPK)가 새 아이콘으로 인식함
    icons: [
      { src: "/icons/icon-192.png?v=4", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=4", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png?v=4", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
