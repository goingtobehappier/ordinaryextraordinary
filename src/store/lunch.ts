"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { todayISO } from "@/lib/date";
import { useCockpit } from "./cockpit";

/** 당일 점심시간 삭제(스킵) 상태. 기본 점심시간 설정은 건드리지 않고 날짜별 예외만 관리 */
type LunchState = {
  /** 점심시간을 삭제한 날짜 (YYYY-MM-DD → true) */
  skipped: Record<string, true>;
  loadedRange: string | null;
  load: (from: string, to: string) => Promise<string | null>;
  /** 현재 범위를 다시 불러옴 (Realtime: 다른 기기에서 바뀐 경우) */
  refresh: () => Promise<void>;
  /** 해당 날짜 점심시간 삭제. 실패 시 롤백하고 오류 메시지 반환 */
  skip: (date?: string | null) => Promise<string | null>;
  /** 해당 날짜 점심시간 복원 */
  restore: (date?: string | null) => Promise<string | null>;
};

type DbError = { code?: string; message: string; details?: string | null };

/**
 * 날짜 컬럼 이름: 앱 스키마는 `date`, 기존(레거시) 테이블은 `skip_date`.
 * 두 컬럼 모두에 같은 값을 보내고, 테이블에 없는 컬럼은 첫 오류 이후 제외함 (세션 동안 기억).
 */
type DateCol = "date" | "skip_date";
let dateCols: DateCol[] = ["date", "skip_date"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 누락·잘못된 날짜는 선택된 날짜 → 오늘 순으로 대체 */
function resolveDate(date?: string | null): string {
  const d = typeof date === "string" ? date.slice(0, 10) : "";
  if (ISO_DATE.test(d)) return d;
  const selected = useCockpit.getState().selectedDate;
  return ISO_DATE.test(selected) ? selected : todayISO();
}

/** PostgREST "Could not find the 'x' column" / Postgres "column x does not exist" → 해당 컬럼 */
function missingDateCol(e: DbError): DateCol | null {
  if (e.code !== "PGRST204" && e.code !== "42703") return null;
  const text = `${e.message} ${e.details ?? ""}`;
  return dateCols.find((c) => new RegExp(`['".]${c}['"\\s]|\\b${c}\\b does not exist`).test(text)) ?? null;
}

/** 없는 날짜 컬럼을 빼고 다시 시도 (남은 컬럼이 하나라도 있을 때만) */
async function withDateCols<T extends { error: DbError | null }>(run: (cols: DateCol[]) => PromiseLike<T>): Promise<T> {
  for (;;) {
    const res = await run(dateCols);
    const missing = res.error && missingDateCol(res.error);
    if (!missing || dateCols.length <= 1) return res;
    dateCols = dateCols.filter((c) => c !== missing);
  }
}

const describe = (e: DbError) =>
  e.code === "42P01" || e.code === "PGRST205"
    ? "lunch_skips 테이블이 없습니다. supabase/migrations/008_lunch_skips.sql을 실행해 주세요."
    : e.code === "23502" || e.code === "PGRST204" || e.code === "42703"
      ? `lunch_skips 테이블 구조가 앱과 다릅니다. supabase/migrations/009_lunch_skips_fix.sql을 실행해 주세요. (${e.message})`
      : e.message;

const logError = (action: string, e: DbError, date: string) =>
  console.error(`[lunch_skips] ${action} 실패`, { date, columns: dateCols, code: e.code, message: e.message, details: e.details });

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
    const sb = createClient();
    const { data, error } = await withDateCols((cols) =>
      sb.from("lunch_skips").select(cols.join(", ")).gte(cols[0], from).lte(cols[0], to),
    );
    // 테이블이 아직 없으면 점심시간은 기본대로 표시 (스킵 시점에 안내)
    if (error) return describe(error);
    set((s) => {
      const next = { ...s.skipped };
      for (const d of Object.keys(next)) if (d >= from && d <= to) delete next[d];
      for (const row of (data ?? []) as unknown as Partial<Record<DateCol, string | null>>[]) {
        const d = (row.date ?? row.skip_date ?? "").slice(0, 10);
        if (ISO_DATE.test(d)) next[d] = true;
      }
      return { skipped: next };
    });
    return null;
  },

  refresh: async () => {
    const range = get().loadedRange;
    if (!range) return;
    const [from, to] = range.split("_");
    set({ loadedRange: null });
    await get().load(from, to);
  },

  skip: async (rawDate) => {
    const date = resolveDate(rawDate);
    set((s) => ({ skipped: { ...s.skipped, [date]: true } }));
    const sb = createClient();
    const { data: auth } = await sb.auth.getSession();
    const userId = auth.session?.user.id ?? useCockpit.getState().userId ?? undefined;
    // 두 날짜 컬럼 모두 채움. upsert 대신 insert + 중복(23505)은 성공 처리 → 테이블마다 다른 unique 구성과 무관
    const { error } = await withDateCols((cols) =>
      sb.from("lunch_skips").insert({
        ...Object.fromEntries(cols.map((c) => [c, date])),
        ...(userId ? { user_id: userId } : {}),
      }),
    );
    if (error && error.code !== "23505") {
      logError("삭제(스킵)", error, date);
      set((s) => ({ skipped: without(s.skipped, date) }));
      return describe(error);
    }
    return null;
  },

  restore: async (rawDate) => {
    const date = resolveDate(rawDate);
    set((s) => ({ skipped: without(s.skipped, date) }));
    const sb = createClient();
    // 어느 컬럼에 기록됐든 지워지도록 남아 있는 날짜 컬럼마다 삭제
    let error: DbError | null = null;
    for (const col of [...dateCols]) {
      const res = await sb.from("lunch_skips").delete().eq(col, date);
      if (!res.error) continue;
      if (missingDateCol(res.error) === col && dateCols.length > 1) {
        dateCols = dateCols.filter((c) => c !== col); // 이 테이블에 없는 컬럼 → 이후 제외
      } else {
        error = res.error;
      }
    }
    if (error) {
      logError("복원", error, date);
      set((s) => ({ skipped: { ...s.skipped, [date]: true } }));
      return describe(error);
    }
    return null;
  },
}));
