"use client";

import { useEffect } from "react";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
/** 이 시간 이상 백그라운드에 있다가 돌아오면 새 배포 여부 확인 */
const CHECK_AFTER_HIDDEN_MS = 60_000;
/** 화면을 계속 켜 두는 경우(PC 등)에도 주기적으로 확인 */
const CHECK_INTERVAL_MS = 30 * 60_000;
/** 입력을 마친 뒤 저장(onBlur flush)이 끝날 시간을 두고 새로고침 */
const RELOAD_DELAY_MS = 2_000;

/** 입력 중인 칸이 있으면 새로고침을 미룸 (메모·상세 등 미저장 내용 보호) */
function isEditing() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/**
 * 서비스 워커 등록 (PWA 설치 · 시스템 알림) + 새 배포 반영.
 * sw.js는 페이지를 캐시하지 않지만, 모바일 PWA는 백그라운드에서 며칠씩 같은 페이지를 유지해
 * 새 배포가 반영되지 않음 → 앱 복귀 시 /api/version을 확인해 빌드가 바뀌었으면 편집 중이 아닐 때 새로고침.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((e) => {
      console.warn("[pwa] 서비스 워커 등록 실패", e);
    });
  }, []);

  useEffect(() => {
    if (!BUILD_ID) return;
    let hiddenAt: number | null = null;
    let updateReady = false;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    const reloadWhenIdle = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (document.visibilityState === "visible" && !isEditing()) window.location.reload();
      }, RELOAD_DELAY_MS);
    };

    const check = async () => {
      if (updateReady) return reloadWhenIdle();
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { id } = (await res.json()) as { id?: string };
        if (id && id !== BUILD_ID) {
          updateReady = true;
          reloadWhenIdle();
        }
      } catch {
        // 오프라인 등: 다음 복귀 때 다시 확인
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= CHECK_AFTER_HIDDEN_MS) void check();
        hiddenAt = null;
      }
    };
    // 새 버전이 준비됐는데 입력 중이었다면, 입력칸을 벗어날 때 다시 시도
    const onFocusOut = () => {
      if (updateReady) reloadWhenIdle();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, CHECK_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      clearInterval(timer);
      if (reloadTimer) clearTimeout(reloadTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return null;
}
