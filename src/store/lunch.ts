"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";

/** 당일 점심시간 삭제(스킵) 상태. 기본 점심시간 설정은 건드리지 않고 날짜별 예외만 관리 */
type LunchState = {
  /** 점심시간을 삭제한 날짜 (YYYY-MM-DD → true) */
  skipped: Record<string, true>;
  loadedRange: string | null;
  load: (from: string, to: string) => Promise<string | null>;
  /** 해당 날짜 점심시간 삭제. 실패 시 롤백하고 오류 메시지 반환 */
  skip: (date: string) => Promise<string | null>;
  /** 해당 날짜 점심시간 복원 */
  restore: (date: string) => Promise<string | null>;
};

const describe = (e: { code?: string; message: string }) =>
  e.code === "42P01" || e.code === "PGRST205"
    ? "lunch_skips 테이블이 없습니다. supabase/migrations/008_lunch_skips.sql을 실행해 주세요."
    : e.message;

const without = (map: Record<string, true>, date: string) => {
  const next = { ...map };
  delete next[date];
  return next;
};

export const useLunch = create<LunchState>()((set, get) => ({
  skipped: {},
  loadedRange: null,

  load: async (from, to) => {
    const key = `${from}_${to}`;
    if (get().loadedRange === key) return null;
    set({ loadedRange: key });
    const { data, error } = await createClient().from("lunch_skips").select("date").gte("date", from).lte("date", to);
    // 테이블이 아직 없으면 점심시간은 기본대로 표시 (스킵 시점에 안내)
    if (error) return describe(error);
    set((s) => {
      const next = { ...s.skipped };
      for (const d of Object.keys(next)) if (d >= from && d <= to) delete next[d];
      for (const row of data ?? []) next[String(row.date).slice(0, 10)] = true;
      return { skipped: next };
    });
    return null;
  },

  skip: async (date) => {
    set((s) => ({ skipped: { ...s.skipped, [date]: true } }));
    const { error } = await createClient().from("lunch_skips").upsert({ date }, { onConflict: "user_id,date" });
    if (error) {
      set((s) => ({ skipped: without(s.skipped, date) }));
      return describe(error);
    }
    return null;
  },

  restore: async (date) => {
    set((s) => ({ skipped: without(s.skipped, date) }));
    const { error } = await createClient().from("lunch_skips").delete().eq("date", date);
    if (error) {
      set((s) => ({ skipped: { ...s.skipped, [date]: true } }));
      return describe(error);
    }
    return null;
  },
}));
