import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ordinaryextraordinary", template: "%s · ordinaryextraordinary" },
  description: "주간 일정 · 할 일 · 데일리 노트를 한 화면에서",
  applicationName: "Ordinary Extraordinary",
  // iOS 홈 화면 앱 (standalone)
  appleWebApp: { capable: true, title: "오디너리엑스트라오디너리", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  openGraph: {
    siteName: "ordinaryextraordinary",
    title: "ordinaryextraordinary",
    description: "주간 일정 · 할 일 · 데일리 노트를 한 화면에서",
  },
};

export const viewport: Viewport = {
  themeColor: "#eef1f6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* Pretendard: 정적(Pretendard) + 가변(Pretendard Variable) */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="h-full">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
