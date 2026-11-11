"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/** 타임테이블 알람 설정 (기기별 · localStorage) */
type AlarmState = {
  /** 시작 시각 알람(시스템 알림 + 알람음) 사용 여부 */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

export const useAlarm = create<AlarmState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: "cockpit-alarm",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ enabled: s.enabled }),
    },
  ),
);
