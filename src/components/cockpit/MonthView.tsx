"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Flag, Loader2 } from "lucide-react";
import { useCockpit } from "@/store/cockpit";
import {
  WEEKDAY_KO,
  isDoneOn,
  monthGrid,
  occursOn,
  parseISODate,
  shortTime,
  timeToMinutes,
  toISODate,
  todayISO,
} from "@/lib/date";
import { isTodoDrag, startTodoDrag } from "@/lib/dnd";
import { CATEGORY_STYLE } from "@/lib/types";
import { cn } from "@/lib/cn";
import { GlassButton, GlassPanel } from "@/components/ui/Glass";
import { useDropToDate } from "./WeekBar";

const MAX_ITEMS = 3;

/** 월별 보기: 클릭 = 날짜 선택(우측 노트 연동), 더블클릭 = 일간 보기로 열기 */
export function MonthView() {
  const selectedDate = useCockpit((s) => s.selectedDate);
  const setSelectedDate = useCockpit((s) => s.setSelectedDate);
  const selectTodo = useCockpit((s) => s.selectTodo);
  const setView = useCockpit((s) => s.setView);
  const todos = useCockpit((s) => s.todos);
  const loading = useCockpit((s) => s.loading);
  const dropToDate = useDropToDate();
  const [dragOver, setDragOver] = useState<string | null>(null);

  const cur = parseISODate(selectedDate);
  const month = cur.getMonth();
  const days = monthGrid(selectedDate);
  const today = todayISO();

  const shiftMonth = (n: number) => {
    const d = new Date(cur.getFullYear(), cur.getMonth() + n, 1);
    setSelectedDate(toISODate(d));
  };

  return (
    <GlassPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-black/5 px-6 py-3.5">
        <h2 className="text-[19px] font-semibold tracking-[-0.01em]">
          {cur.getFullYear()}년 {month + 1}월
        </h2>
        <div className="flex">
          <GlassButton className="px-1.5" onClick={() => shiftMonth(-1)} aria-label="이전 달">
            <ChevronLeft className="size-4" />
          </GlassButton>
          <GlassButton className="px-1.5" onClick={() => shiftMonth(1)} aria-label="다음 달">
            <ChevronRight className="size-4" />
          </GlassButton>
        </div>
        <GlassButton className="text-xs" onClick={() => setSelectedDate(today)}>
          오늘
        </GlassButton>
        {loading && <Loader2 className="size-4 animate-spin text-ink-2" />}
        <span className="ml-auto text-xs text-ink-2">클릭: 날짜 선택 · 더블클릭: 일간 보기 · 할 일을 다른 날짜로 끌어 옮기기</span>
      </div>

      <div className="grid grid-cols-7 border-b border-black/5 px-3 pt-2">
        {WEEKDAY_KO.map((w, i) => (
          <div key={w} className={cn("px-2 pb-1.5 text-xs font-medium", i >= 5 ? "text-[#ff3b30]/80" : "text-ink-2")}>
            {w}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1.5 p-3">
        {days.map((iso, i) => {
          const items = todos
            .filter((t) => occursOn(t, iso))
            .sort((a, b) => (timeToMinutes(a.start_time) ?? 9999) - (timeToMinutes(b.start_time) ?? 9999));
          const inMonth = parseISODate(iso).getMonth() === month;
          const selected = iso === selectedDate;
          const due = items.filter((t) => t.category === "마감" && !isDoneOn(t, iso)).length;
          return (
            <div
              key={iso}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedDate(iso)}
              onDoubleClick={() => {
                setSelectedDate(iso);
                setView("day");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSelectedDate(iso);
                  setView("day");
                }
              }}
              onDragOver={(e) => {
                if (!isTodoDrag(e)) return;
                e.preventDefault();
                setDragOver(iso);
              }}
              onDragLeave={() => setDragOver((d) => (d === iso ? null : d))}
              onDrop={(e) => {
                setDragOver(null);
                dropToDate(e, iso);
              }}
              className={cn(
                "flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-lg border p-1.5 outline-none transition-[background-color,border-color,box-shadow]",
                "focus-visible:ring-2 focus-visible:ring-apple-blue/40",
                selected ? "border-apple-blue/50 bg-apple-blue/[0.07]" : "border-white/50 bg-white/40 hover:bg-white/70",
                !inMonth && "opacity-45",
                dragOver === iso && "ring-2 ring-apple-mint",
              )}
            >
              <div className="mb-1 flex items-center gap-1 px-0.5">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-md text-[13px] font-semibold tabular-nums",
                    iso === today ? "bg-apple-blue text-white" : i % 7 >= 5 ? "text-[#ff3b30]/80" : "text-ink",
                  )}
                >
                  {parseISODate(iso).getDate()}
                </span>
                {due > 0 && (
                  <span className="flex items-center gap-0.5 rounded-md bg-[#ff3b30] px-1 text-[10px] font-bold text-white">
                    <Flag className="size-2.5" />
                    {due}
                  </span>
                )}
                {items.length > 0 && <span className="ml-auto text-[10px] tabular-nums text-ink-2">{items.length}</span>}
              </div>
              <ul className="min-h-0 space-y-0.5">
                {items.slice(0, MAX_ITEMS).map((t) => (
                  <li
                    key={t.id}
                    draggable={t.repeat === "none"}
                    onDragStart={(e) => startTodoDrag(e, t)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDate(iso);
                      selectTodo(t.id);
                    }}
                    className="flex items-center gap-1 truncate rounded-md px-1 py-px text-[11px] hover:bg-white/80"
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", CATEGORY_STYLE[t.category].dot)} />
                    {t.start_time && <span className="shrink-0 font-semibold tabular-nums">{shortTime(t.start_time)}</span>}
                    <span className={cn("truncate", isDoneOn(t, iso) && "text-ink-2 line-through")}>{t.title}</span>
                  </li>
                ))}
                {items.length > MAX_ITEMS && <li className="px-1 text-[10px] text-ink-2">+{items.length - MAX_ITEMS}건 더보기</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
