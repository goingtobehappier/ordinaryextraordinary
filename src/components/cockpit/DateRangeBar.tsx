"use client";

import { useState } from "react";
import { CalendarRange, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { defaultSearchRange, useCockpit, type DateRange } from "@/store/cockpit";
import { addDays, todayISO } from "@/lib/date";
import { cn } from "@/lib/cn";

const ALL = "전체";

function presets(): { label: string; range: DateRange }[] {
  const today = todayISO();
  const y = Number(today.slice(0, 4));
  return [
    { label: "올해", range: defaultSearchRange() },
    { label: "최근 1개월", range: { start: addDays(today, -30), end: today } },
    { label: "최근 3개월", range: { start: addDays(today, -91), end: today } },
    { label: "작년", range: { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` } },
    { label: "올해 전체", range: { start: `${y}-01-01`, end: `${y}-12-31` } },
    { label: "내년", range: { start: `${y + 1}-01-01`, end: `${y + 1}-12-31` } },
  ];
}

/** 한 테이블에서 가장 이른·늦은 날짜 (행 2개만 조회) */
async function dateBounds(table: "todos" | "daily_notes", userId: string) {
  const sb = createClient();
  const pick = (ascending: boolean) =>
    sb.from(table).select("date").eq("user_id", userId).order("date", { ascending }).limit(1).maybeSingle();
  const [first, last] = await Promise.all([pick(true), pick(false)]);
  const d = (r: typeof first) => (r.data as { date: string } | null)?.date?.slice(0, 10) ?? null;
  return [d(first), d(last)] as const;
}

/** 등록된 전체 기간: 할 일·데일리 노트 중 가장 이른 날 ~ 가장 늦은 날 (오늘까지는 항상 포함) */
async function fullRange(userId: string): Promise<DateRange> {
  const today = todayISO();
  const bounds = (await Promise.all([dateBounds("todos", userId), dateBounds("daily_notes", userId)])).flat();
  const dates = bounds.filter((x): x is string => !!x);
  return {
    start: dates.reduce((a, b) => (b < a ? b : a), today),
    end: dates.reduce((a, b) => (b > a ? b : a), today),
  };
}

/** 조회 기간 컨트롤: 시작일 ~ 종료일 + 빠른 선택 */
export function DateRangeBar({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const userId = useCockpit((s) => s.userId);
  const [all, setAll] = useState<DateRange | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const list = presets();
  const same = (r: DateRange | null) => !!r && r.start === range.start && r.end === range.end;
  const active = list.find((p) => same(p.range))?.label ?? (same(all) ? ALL : undefined);

  async function pickAll() {
    if (!userId || loadingAll) return;
    setLoadingAll(true);
    try {
      const r = await fullRange(userId);
      setAll(r);
      onChange(r);
    } catch {
      useCockpit.getState().setError("전체 기간을 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setLoadingAll(false);
    }
  }

  const btn = (on: boolean) =>
    cn(
      "rounded-md px-2 py-1 text-xs font-medium transition-[background-color,color]",
      on ? "bg-white text-apple-blue shadow-sm" : "text-ink-2 hover:text-ink",
    );

  const picker = (
      <div className="flex items-center gap-1.5 rounded-md border border-black/5 bg-white/60 px-2.5 py-1 text-sm">
        <CalendarRange className="size-4 text-ink-2" />
        <input
          type="date"
          value={range.start}
          max={range.end}
          onChange={(e) => e.target.value && onChange({ ...range, start: e.target.value })}
          className="bg-transparent tabular-nums outline-none"
          aria-label="조회 시작일"
        />
        <span className="text-ink-2">~</span>
        <input
          type="date"
          value={range.end}
          min={range.start}
          onChange={(e) => e.target.value && onChange({ ...range, end: e.target.value })}
          className="bg-transparent tabular-nums outline-none"
          aria-label="조회 종료일"
        />
      </div>
  );

  const quick = (
      <div className="flex flex-wrap rounded-md bg-black/5 p-0.5" role="group" aria-label="기간 빠른 선택">
        {list.map((p) => (
          <button key={p.label} onClick={() => onChange(p.range)} className={btn(active === p.label)}>
            {p.label}
          </button>
        ))}
        <button
          onClick={pickAll}
          disabled={loadingAll}
          className={cn(btn(active === ALL), "inline-flex items-center gap-1")}
          title="등록된 일정·메모의 가장 이른 날부터 가장 늦은 날까지"
        >
          {loadingAll && <Loader2 className="size-3 animate-spin" />}
          {ALL}
        </button>
      </div>
  );

  return (
    <>
      {picker}
      {quick}
    </>
  );
}
