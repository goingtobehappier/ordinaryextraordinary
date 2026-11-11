"use client";

import { useEffect } from "react";

/** 서비스 워커 등록 (PWA 설치 · 시스템 알림). 미지원 브라우저에서는 아무것도 하지 않음 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((e) => {
      console.warn("[pwa] 서비스 워커 등록 실패", e);
    });
  }, []);
  return null;
}
