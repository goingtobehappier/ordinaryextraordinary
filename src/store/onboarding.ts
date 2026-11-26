"use client";

import { create } from "zustand";

/** 온보딩 튜토리얼 화면 상태. DB와 무관하며 완료 여부는 localStorage에만 저장 */
type OnboardingState = {
  /** welcome = 첫 접속 환영 모달 / tour = 스포트라이트 가이드 투어 */
  phase: "welcome" | "tour" | null;
  openWelcome: () => void;
  startTour: () => void;
  close: () => void;
};

export const useOnboarding = create<OnboardingState>((set) => ({
  phase: null,
  openWelcome: () => set({ phase: "welcome" }),
  startTour: () => set({ phase: "tour" }),
  close: () => set({ phase: null }),
}));

export const onboardingKey = (userId: string) => `oe_onboarding_completed_${userId}`;

export function isOnboardingDone(userId: string): boolean {
  try {
    return localStorage.getItem(onboardingKey(userId)) === "1";
  } catch {
    // 저장소 접근이 막힌 환경(사파리 개인정보 보호 등)에서는 매번 묻지 않도록 완료로 간주
    return true;
  }
}

export function markOnboardingDone(userId: string) {
  try {
    localStorage.setItem(onboardingKey(userId), "1");
  } catch {
    /* 저장 실패는 무시 (다음 접속 때 다시 안내될 뿐) */
  }
}
