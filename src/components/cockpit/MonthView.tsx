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
import { DEADLINE_SLOT } from "@/lib/types";
import { useCategoryLabels, useCategoryStyle } from "@/store/categories";
import { cn } from "@/lib/cn";
import { GlassButton, GlassPanel } from "@/components/ui/Glass";
import { useDropToDate } from "./WeekBar";
import { CategoryFilterChips, useActiveCategoryFilter } from "./CategoryFilterChips";
import { ExternalEventRow, useExternalEventsByDate, useSourceColors } from "./ExternalEvents";

const MAX_ITEMS = 3;

/** 월간 보기: 클릭 = 날짜 선택(우측 과업 리스트·노트 연동, 선택 유지), 더블클릭 = 일간 보기로 열기 */
export function MonthView() {
  const styleOf = useCategoryStyle();
  const labels = useCategoryLabels();
  const deadlineLabel = labels[DEADLINE_SLOT];
  // 1차 태그 필터: 비어 있으면 전체. 이름이 바뀌면 스토어에서 함께 바뀌고, 현재 이름에 없는 값은 무시
  const storedFilter = useCockpit((s) => s.monthCategories);
  const toggleFilter = useCockpit((s) => s.toggleMonthCategory);
  const clearFilter = useCockpit((s) => s.clearMonthCategories);
  const filter = useActiveCategoryFilter(storedFilter);
  const filtering = filter.length > 0;
  const selectedDate = useCockpit((s) => s.selectedDate);
  const setSelectedDate = useCockpit((s) => s.setSelectedDate);
  const selectTodo = useCockpit((s) => s.selectTodo);
  const setView = useCockpit((s) => s.setView);
  const todos = useCockpit((s) => s.todos);
  const loading = useCockpit((s) => s.loading);
  const dropToDate = useDropToDate();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const externalOn = useExternalEventsByDate();
  const sourceColors = useSourceColors();

  const cur = parseISODate(selectedDate);
  const month = cur.getMonth();
  const days = monthGrid(selectedDate);
  const today = todayISO();

  const shiftMonth = (n: number) => {
    const d = new Date(cur.getFullYear(), cur.getMonth() + n, 1);
    setSelectedDate(toISODate(d));
  };

  return (
    <GlassPanel className="flex h-[560px] min-h-0 min-w-0 flex-col overflow-hidden sm:h-[640px] lg:h-auto lg:flex-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-black/5 px-4 py-3 sm:px-6 sm:py-3.5">
        <h2 className="shrink-0 whitespace-nowrap text-[17px] font-semibold tracking-[-0.01em] sm:text-[19px]">
          {cur.getFullYear()}년 {month + 1}월
        </h2>
        <div className="flex shrink-0">
          <GlassButton className="px-1.5" onClick={() => shiftMonth(-1)} aria-label="이전 달">
            <ChevronLeft className="size-4" />
          </GlassButton>
          <GlassButton className="px-1.5" onClick={() => shiftMonth(1)} aria-label="다음 달">
            <ChevronRight className="size-4" />
          </GlassButton>
        </div>
        <GlassButton className="shrink-0 whitespace-nowrap text-xs" onClick={() => setSelectedDate(today)}>
          오늘
        </GlassButton>
        {/* 1차 태그 필터 (토글 · 다중 선택). 좁은 화면에서는 가로 스크롤 */}
        <CategoryFilterChips value={filter} onToggle={toggleFilter} onClear={clearFilter} />
        {loading && <Loader2 className="size-4 shrink-0 animate-spin text-ink-2" />}
        <span className="ml-auto hidden min-w-0 truncate text-xs text-ink-2 2xl:block" title="클릭: 날짜 선택 · 더블클릭: 일간 보기 · 할 일을 다른 날짜로 끌어 옮기기">
          클릭: 날짜 선택 · 더블클릭: 일간 보기 · 할 일을 다른 날짜로 끌어 옮기기
        </span>
      </div>

      <div className="grid grid-cols-7 border-b border-black/5 px-1.5 pt-2 sm:px-3">
        {WEEKDAY_KO.map((w, i) => (
          <div key={w} className={cn("px-1 pb-1.5 text-center text-xs font-medium sm:px-2 sm:text-left", i >= 5 ? "text-[#ff3b30]/80" : "text-ink-2")}>
            {w}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1 p-1.5 sm:gap-1.5 sm:p-3">
        {days.map((iso, i) => {
          const items = todos
            .filter((t) => occursOn(t, iso) && (!filtering || filter.includes(t.category)))
            .sort((a, b) => (timeToMinutes(a.start_time) ?? 9999) - (timeToMinutes(b.start_time) ?? 9999));
          const inMonth = parseISODate(iso).getMonth() === month;
          const selected = iso === selectedDate;
          const due = items.filter((t) => t.category === deadlineLabel && !isDoneOn(t, iso)).length;
          // 외부 일정은 할 일 다음 남는 칸에 표시, 넘치는 건수는 '더보기'에 합산
          // 태그 필터 중에는 태그가 없는 외부 캘린더 일정은 숨김
          const external = filtering ? [] : externalOn(iso);
          const externalShown = external.slice(0, Math.max(0, MAX_ITEMS - items.length));
          const hidden = items.length + external.length - Math.min(items.length, MAX_ITEMS) - externalShown.length;
          return (
            <div
              key={iso}
              role="button"
              tabIndex={0}
              // 이미 선택된 날짜를 다시 클릭해도 선택(및 열린 과업 상세)이 유지되도록
              onClick={() => {
                if (iso !== selectedDate) setSelectedDate(iso);
              }}
              aria-pressed={selected}
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
                "flex min-h-0 min-w-0 cursor-pointer flex-col overflow-hidden rounded-lg border p-1 outline-none transition-[background-color,border-color,box-shadow] sm:p-1.5",
                "focus-visible:ring-2 focus-visible:ring-apple-blue/40",
                selected ? "border-apple-blue/50 bg-apple-blue/[0.07]" : "border-white/50 bg-white/40 hover:bg-white/70",
                !inMonth && "opacity-45",
                dragOver === iso && "ring-2 ring-apple-mint",
              )}
            >
              <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1 px-0.5 max-sm:justify-center">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md text-[13px] font-semibold tabular-nums",
                    iso === today ? "bg-apple-blue text-white" : i % 7 >= 5 ? "text-[#ff3b30]/80" : "text-ink",
                  )}
                >
                  {parseISODate(iso).getDate()}
                </span>
                {due > 0 && (
                  <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-[#ff3b30] px-1 text-[10px] font-bold text-white">
                    <Flag className="size-2.5" />
                    {due}
                  </span>
                )}
                {items.length + external.length > 0 && (
                  <span className="ml-auto hidden text-[10px] tabular-nums text-ink-2 sm:inline">{items.length + external.length}</span>
                )}
              </div>
              {/* 모바일: 칸이 좁아 제목 대신 색상 점으로 개수 표시 (외부 일정은 네모 점) */}
              {items.length + external.length > 0 && (
                <div
                  className="flex flex-wrap items-center justify-center gap-0.5 sm:hidden"
                  aria-label={`할 일 ${items.length}건${external.length ? `, 외부 일정 ${external.length}건` : ""}`}
                >
                  {items.slice(0, MAX_ITEMS).map((t) => (
                    <span key={t.id} className={cn("size-1.5 rounded-full", styleOf(t.category).dot, isDoneOn(t, iso) && "opacity-40")} />
                  ))}
                  {externalShown.map((e) => (
                    <span key={e.id} className="size-1.5 rounded-[2px]" style={{ background: sourceColors.get(e.sourceId) ?? "#8e44ad" }} />
                  ))}
                  {hidden > 0 && <span className="text-[9px] leading-none text-ink-2">+{hidden}</span>}
                </div>
              )}
              <ul className="hidden min-h-0 min-w-0 space-y-0.5 sm:block">
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
                    title={t.title}
                    className="flex min-w-0 items-center gap-1 truncate rounded-md px-1 py-px text-[11px] hover:bg-white/80"
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", styleOf(t.category).dot)} />
                    {t.start_time && <span className="shrink-0 font-semibold tabular-nums">{shortTime(t.start_time)}</span>}
                    <span className={cn("truncate", isDoneOn(t, iso) && "text-ink-2 line-through")}>{t.title}</span>
                  </li>
                ))}
                {externalShown.map((e) => (
                  <li key={e.id} className="px-1 py-px">
                    <ExternalEventRow event={e} color={sourceColors.get(e.sourceId)} />
                  </li>
                ))}
                {hidden > 0 && <li className="truncate px-1 text-[10px] text-ink-2">+{hidden}건 더보기</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
