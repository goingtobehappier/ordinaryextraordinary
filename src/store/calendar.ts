"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import {
  SOURCE_COLORS,
  normalizeCalendarUrl,
  type CalendarEvent,
  type CalendarResponse,
  type CalendarSource,
} from "@/lib/calendar/types";

type NewSource = { name: string; url: string; sync_start: string };

type CalendarState = {
  sources: CalendarSource[];
  sourcesLoaded: boolean;
  events: CalendarEvent[];
  /** 소스별 마지막 불러오기 오류 */
  errors: Record<string, string>;
  loading: boolean;
  /** 마지막으로 요청한 범위 (소스 변경 후 같은 범위 재요청용) */
  range: { from: string; to: string } | null;
  modalOpen: boolean;

  setModalOpen: (open: boolean) => void;
  loadSources: () => Promise<string | null>;
  loadEvents: (from: string, to: string, force?: boolean) => Promise<void>;
  reload: () => Promise<void>;
  addSource: (input: NewSource) => Promise<string | null>;
  updateSource: (id: string, patch: Partial<Pick<CalendarSource, "name" | "sync_start">>) => Promise<string | null>;
  removeSource: (id: string) => Promise<string | null>;
};

const userTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul";
  } catch {
    return "Asia/Seoul";
  }
};

const sourceError = (e: { code?: string; message: string }) =>
  e.code === "42P01" || e.code === "PGRST205"
    ? "calendar_sources 테이블이 없습니다. supabase/migrations/007_calendar_sources.sql을 실행해 주세요."
    : e.code === "23505"
      ? "이미 연동된 캘린더 주소입니다."
      : e.message;

let requestSeq = 0;

export const useCalendar = create<CalendarState>()((set, get) => ({
  sources: [],
  sourcesLoaded: false,
  events: [],
  errors: {},
  loading: false,
  range: null,
  modalOpen: false,

  setModalOpen: (open) => set({ modalOpen: open }),

  loadSources: async () => {
    const { data, error } = await createClient()
      .from("calendar_sources")
      .select("id, name, url, sync_start, color, created_at")
      .order("created_at");
    if (error) {
      set({ sourcesLoaded: true });
      return sourceError(error);
    }
    set({ sources: (data ?? []) as CalendarSource[], sourcesLoaded: true });
    return null;
  },

  loadEvents: async (from, to, force = false) => {
    const prev = get().range;
    if (!force && prev && prev.from === from && prev.to === to) return;
    set({ range: { from, to } });
    if (!get().sourcesLoaded) await get().loadSources();
    if (!get().sources.length) {
      set({ events: [], errors: {}, loading: false });
      return;
    }

    const seq = ++requestSeq;
    set({ loading: true });
    try {
      const qs = new URLSearchParams({ from, to, tz: userTz() });
      const res = await fetch(`/api/calendar?${qs}`, { cache: "no-store" });
      const body = (await res.json()) as CalendarResponse & { error?: string };
      if (seq !== requestSeq) return; // 더 최신 요청이 있음
      if (!res.ok) {
        const msg = body.error ?? `외부 캘린더를 불러오지 못했습니다 (${res.status})`;
        set({ loading: false, errors: Object.fromEntries(get().sources.map((s) => [s.id, msg])) });
        return;
      }
      set({
        events: body.events,
        errors: Object.fromEntries(body.errors.map((e) => [e.sourceId, e.message])),
        loading: false,
      });
    } catch {
      if (seq === requestSeq) set({ loading: false });
    }
  },

  reload: async () => {
    const r = get().range;
    if (r) await get().loadEvents(r.from, r.to, true);
  },

  addSource: async ({ name, url, sync_start }) => {
    const normalized = normalizeCalendarUrl(url);
    if (!normalized) return "올바른 iCal 주소(https:// 또는 webcal://)를 입력해 주세요.";
    const color = SOURCE_COLORS[get().sources.length % SOURCE_COLORS.length];
    const { data, error } = await createClient()
      .from("calendar_sources")
      .insert({ name: name.trim() || "외부 캘린더", url: normalized, sync_start, color })
      .select("id, name, url, sync_start, color, created_at")
      .single();
    if (error) return sourceError(error);
    set((s) => ({ sources: [...s.sources, data as CalendarSource] }));
    await get().reload();
    return null;
  },

  updateSource: async (id, patch) => {
    const prev = get().sources;
    set({ sources: prev.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
    const { error } = await createClient().from("calendar_sources").update(patch).eq("id", id);
    if (error) {
      set({ sources: prev });
      return sourceError(error);
    }
    await get().reload();
    return null;
  },

  removeSource: async (id) => {
    const prev = get();
    set((s) => ({ sources: s.sources.filter((x) => x.id !== id), events: s.events.filter((e) => e.sourceId !== id) }));
    const { error } = await createClient().from("calendar_sources").delete().eq("id", id);
    if (error) {
      set({ sources: prev.sources, events: prev.events });
      return sourceError(error);
    }
    return null;
  },
}));

/** 특정 날짜의 외부 일정 (종일 먼저, 그다음 시작 시각 순) */
export function eventsOn(events: CalendarEvent[], date: string) {
  return events
    .filter((e) => e.date === date)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.start ?? "").localeCompare(b.start ?? ""));
}
