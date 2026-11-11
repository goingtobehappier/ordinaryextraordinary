"use client";

import { useSyncExternalStore } from "react";

/** 모바일 화면 기준: Tailwind `md`(768px) 미만 — 할 일 목록·타임블록이 상하로 쌓이는 폭 */
export const MOBILE_QUERY = "(max-width: 767.98px)";

export const isMobileNow = () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** 모바일(앱) 화면 여부. 화면 회전·창 크기 변경에 따라 갱신 (서버 렌더에서는 false) */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}
