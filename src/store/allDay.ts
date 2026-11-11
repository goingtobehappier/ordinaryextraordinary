"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useCockpit } from "./cockpit";

/** 종일 일정 (연차·휴가·여행 등). date ~ end_date(포함), end_date가 없으면 하루 */
export type AllDayEvent = {
  id: string;
  user_id: string;
  date: string;
  end_date: string | null;
  title: string;
  emoji: string;
  color: string;
  created_at: string;
};

export type AllDayInput = Pick<AllDayEvent, "date" | "end_date" | "title" | "emoji" | "color">;

/** 빠른 추가 프리셋 */
export const ALL_DAY_PRESETS: { title: string; emoji: string; color: string }[] = [
  { title: "연차", emoji: "✈️", color: "#007aff" },
  { title: "반차", emoji: "🌗", color: "#5856d6" },
  { title: "휴가", emoji: "🏖️", color: "#00c7be" },
  { title: "가족 여행", emoji: "🧳", color: "#ff9500" },
  { title: "출장", emoji: "💼", color: "#af52de" },
  { title: "병가", emoji: "🏥", color: "#ff3b30" },
];

export const ALL_DAY_EMOJIS = ["✈️", "🏖️", "🧳", "🌴", "🌗", "💼", "🏥", "🎂", "🎉", "🏠", "🚗", "📌"];
export const ALL_DAY_COLORS = ["#007aff", "#5856d6", "#af52de", "#ff3b30", "#ff9500", "#34c759", "#00c7be", "#8e8e93"];

/** 해당 날짜에 걸치는 일정인지 */
export const coversDate = (e: Pick<AllDayEvent, "date" | "end_date">, iso: string) =>
  e.date <= iso && (e.end_date ?? e.date) >= iso;

type DbError = { code?: string; message: string };

const describe = (e: DbError) =>
  e.code === "42P01" || e.code === "PGRST205"
    ? "종일 일정 테이블이 없습니다. supabase/migrations/013_all_day_events.sql을 실행해 주세요."
    : e.code === "23514"
      ? "종료일은 시작일 이후여야 합니다."
      : e.message;

const sortEvents = (list: AllDayEvent[]) =>
  [...list].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));

/** 빈 종료일·시작일과 같은 종료일은 null(하루 일정)로 */
const normalizeInput = (input: AllDayInput): AllDayInput => ({
  ...input,
  title: input.title.trim(),
  end_date: input.end_date && input.end_date > input.date ? input.end_date : null,
});

type AllDayState = {
  events: AllDayEvent[];
  loadedRange: string | null;
  /** 테이블이 없는 등 불러오기 실패 원인 (배너에 안내) */
  loadError: string | null;
  load: (from: string, to: string, force?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  add: (input: AllDayInput) => Promise<string | null>;
  update: (id: string, input: AllDayInput) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  reset: () => void;
};

export const useAllDay = create<AllDayState>()((set, get) => ({
  events: [],
  loadedRange: null,
  loadError: null,

  load: async (from, to, force = false) => {
    const key = `${from}_${to}`;
    if (!force && get().loadedRange === key) return;
    set({ loadedRange: key });
    const userId = useCockpit.getState().userId;
    if (!userId) return;
    // 기간 일정이 범위에 걸치기만 해도 포함: 시작일 ≤ to 이고 (종료일 ≥ from 또는 하루 일정이면 시작일 ≥ from)
    const { data, error } = await createClient()
      .from("all_day_events")
      .select("*")
      .eq("user_id", userId)
      .lte("date", to)
      .or(`end_date.gte.${from},and(end_date.is.null,date.gte.${from})`)
      .order("date", { ascending: true });
    if (get().loadedRange !== key) return;
    if (error) {
      set({ loadError: describe(error) });
      return;
    }
    set({ events: sortEvents((data ?? []) as AllDayEvent[]), loadError: null });
  },

  refresh: async () => {
    const range = get().loadedRange;
    if (!range) return;
    const [from, to] = range.split("_");
    await get().load(from, to, true);
  },

  add: async (raw) => {
    const userId = useCockpit.getState().userId;
    if (!userId) return "로그인이 필요합니다.";
    const input = normalizeInput(raw);
    const { data, error } = await createClient()
      .from("all_day_events")
      .insert({ ...input, user_id: userId })
      .select()
      .single();
    if (error) return describe(error);
    const ev = data as AllDayEvent;
    set((s) => ({ events: sortEvents([...s.events.filter((e) => e.id !== ev.id), ev]) }));
    return null;
  },

  update: async (id, raw) => {
    const input = normalizeInput(raw);
    const prev = get().events;
    set({ events: sortEvents(prev.map((e) => (e.id === id ? { ...e, ...input } : e))) });
    const { error } = await createClient().from("all_day_events").update(input).eq("id", id);
    if (error) {
      set({ events: prev });
      return describe(error);
    }
    return null;
  },

  remove: async (id) => {
    const prev = get().events;
    set({ events: prev.filter((e) => e.id !== id) });
    const { data, error } = await createClient().from("all_day_events").delete().eq("id", id).select("id");
    if (error || !data?.length) {
      set({ events: prev });
      return error ? describe(error) : "종일 일정을 삭제하지 못했습니다.";
    }
    return null;
  },

  reset: () => set({ events: [], loadedRange: null, loadError: null }),
}));
