"use client";

import { CalendarRange } from "lucide-react";
import { defaultSearchRange, type DateRange } from "@/store/cockpit";
import { addDays, todayISO } from "@/lib/date";
import { cn } from "@/lib/cn";

function presets(): { label: string; range: DateRange }[] {
  const today = todayISO();
  const y = Number(today.slice(0, 4));
  return [
    { label: "올해", range: defaultSearchRange() },
    { label: "최근 1개월", range: { start: addDays(today, -30), end: today } },
    { label: "최근 3개월", range: { start: addDays(today, -91), end: today } },
    { label: "작년", range: { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` } },
    { label: "올해 전체", range: { start: `${y}-01-01`, end: `${y}-12-31` } },
  ];
}

/** 조회 기간 컨트롤: 시작일 ~ 종료일 + 빠른 선택 */
export function DateRangeBar({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const list = presets();
  const active = list.find((p) => p.range.start === range.start && p.range.end === range.end)?.label;
  return (
    <>
      <div className="flex items-center gap-1.5 rounded-lg border border-black/5 bg-white/60 px-2.5 py-1 text-sm">
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
      <div className="flex rounded-lg bg-black/5 p-0.5" role="group" aria-label="기간 빠른 선택">
        {list.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.range)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-[background-color,color]",
              active === p.label ? "bg-white text-apple-blue shadow-sm" : "text-ink-2 hover:text-ink",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </>
  );
}
