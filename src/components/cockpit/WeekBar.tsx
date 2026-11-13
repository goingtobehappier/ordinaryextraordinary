"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { useCockpit } from "@/store/cockpit";
import {
  WEEKDAY_KO,
  addDays,
  isDoneOn,
  occursOn,
  parseISODate,
  shortTime,
  timeToMinutes,
  todayISO,
  weekDates,
} from "@/lib/date";
import { isTodoDrag, readTodoDrag } from "@/lib/dnd";
import { DEADLINE_SLOT, type Todo } from "@/lib/types";
import { useCategoryLabels, useCategoryStyle } from "@/store/categories";
import { CategoryFilterChips, useActiveCategoryFilter } from "./CategoryFilterChips";
import { cn } from "@/lib/cn";
import { GlassButton, GlassPanel } from "@/components/ui/Glass";
import { ExternalEventRow, useExternalEventsByDate, useSourceColors } from "./ExternalEvents";
import { allDayChipStyle } from "./AllDayBanner";
import { coversDate, useAllDay } from "@/store/allDay";

const byTime = (a: Todo, b: Todo) =>
  (timeToMinutes(a.start_time) ?? 9999) - (timeToMinutes(b.start_time) ?? 9999);

/** 드롭된 할 일을 해당 날짜로 이동 (목록·이동 필요 목록 어디서 왔든) */
export function useDropToDate() {
  const moveTodoToDate = useCockpit((s) => s.moveTodoToDate);
  return (e: React.DragEvent, iso: string) => {
    const id = readTodoDrag(e);
    if (!id) return;
    e.preventDefault();
    const { todos, overdue } = useCockpit.getState();
    const todo = todos.find((t) => t.id === id) ?? overdue.find((t) => t.id === id);
    if (todo) void moveTodoToDate(todo, iso);
  };
}

export function WeekBar() {
  const styleOf = useCategoryStyle();
  const deadlineLabel = useCategoryLabels()[DEADLINE_SLOT];
  const selectedDate = useCockpit((s) => s.selectedDate);
  const setSelectedDate = useCockpit((s) => s.setSelectedDate);
  const todos = useCockpit((s) => s.todos);
  const dropToDate = useDropToDate();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const externalOn = useExternalEventsByDate();
  const sourceColors = useSourceColors();
  const allDayEvents = useAllDay((s) => s.events);
  // 1차 태그 필터 — 일간·주간 공용(activeCategories): 주간 카드와 아래 목록·타임블록이 함께 걸러짐
  const storedFilter = useCockpit((s) => s.activeCategories);
  const toggleFilter = useCockpit((s) => s.toggleCategory);
  const clearFilter = useCockpit((s) => s.clearCategories);
  const filter = useActiveCategoryFilter(storedFilter);
  const filtering = filter.length > 0;

  const days = weekDates(selectedDate);
  const today = todayISO();
  const first = parseISODate(days[0]);

  const perDay = days.map((iso) => ({ iso, items: todos.filter((t) => occursOn(t, iso) && (!filtering || filter.includes(t.category))).sort(byTime) }));

  return (
    <GlassPanel className="relative z-20 flex min-w-0 shrink-0 flex-col gap-3 px-2.5 pb-3 pt-3 sm:px-4 sm:pb-4">
      {/* 월 · 주 이동 · 오늘 · 1차 태그 필터 (좁은 화면에서는 줄바꿈) */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 pl-1 text-xs">
        <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em]">
          {first.getFullYear()}년 {first.getMonth() + 1}월
        </span>
        <div className="flex shrink-0 items-center">
          <GlassButton className="px-1.5 py-1" onClick={() => setSelectedDate(addDays(selectedDate, -7))} aria-label="이전 주">
            <ChevronLeft className="size-4" />
          </GlassButton>
          <GlassButton className="px-1.5 py-1" onClick={() => setSelectedDate(addDays(selectedDate, 7))} aria-label="다음 주">
            <ChevronRight className="size-4" />
          </GlassButton>
        </div>
        <GlassButton className="shrink-0 whitespace-nowrap py-1 text-xs" onClick={() => setSelectedDate(today)}>
          오늘
        </GlassButton>

        {/* 1차 태그 필터 — 남는 폭을 쓰고, 좁은 화면에서는 아랫줄 전체 폭 + 가로 스크롤 */}
        <span aria-hidden className="mx-1 hidden h-4 w-px shrink-0 bg-black/10 sm:block" />
        <CategoryFilterChips value={filter} onToggle={toggleFilter} onClear={clearFilter} className="max-sm:w-full" />

      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5 md:gap-2.5">
        {perDay.map(({ iso, items }, i) => {
          const done = items.filter((t) => isDoneOn(t, iso)).length;
          const dueCount = items.filter((t) => t.category === deadlineLabel && !isDoneOn(t, iso)).length;
          const timedItems = items.filter((t) => t.start_time);
          // 태그 필터 중에는 태그가 없는 외부 캘린더 일정은 숨김
          const external = filtering ? [] : externalOn(iso);
          const allDay = allDayEvents.filter((e) => coversDate(e, iso));
          // 종일 일정 칩이 있으면 일정 줄을 1줄로 줄여 카드 높이 유지
          const rows = allDay.length ? 1 : 2;
          // 할 일을 먼저 채우고 남는 칸에 외부 일정
          const externalShown = external.slice(0, Math.max(0, rows - Math.min(timedItems.length, rows)));
          const selected = iso === selectedDate;
          const isToday = iso === today;
          const weekend = i >= 5;
          return (
            <button
              key={iso}
              onClick={() => setSelectedDate(iso)}
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
              aria-pressed={selected}
              className={cn(
                // 모바일: 요일·날짜·진행률만 표시하는 컴팩트 카드 / 태블릿 이상: 지정 시간 일정까지
                "group relative flex h-[84px] min-w-0 flex-col overflow-hidden rounded-xl border px-1.5 py-1.5 text-left sm:px-2 md:h-[118px] md:px-3 md:py-2",
                "transition-[background-color,box-shadow,transform,border-color] duration-200 active:scale-[0.98]",
                selected
                  ? "border-transparent bg-apple-blue text-white shadow-lg shadow-apple-blue/30"
                  : "border-white/50 bg-white/50 hover:bg-white/80",
                dragOver === iso && "ring-2 ring-apple-mint ring-offset-2",
              )}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 md:flex-nowrap">
                <span
                  className={cn(
                    "shrink-0 text-xs font-medium",
                    selected ? "text-white/80" : weekend ? "text-[#ff3b30]/80" : "text-ink-2",
                  )}
                >
                  {WEEKDAY_KO[i]}
                </span>
                <span className="shrink-0 text-[17px] font-semibold leading-none tracking-[-0.02em] md:text-[20px]">{parseISODate(iso).getDate()}</span>
                {isToday && (
                  <span
                    className={cn(
                      "hidden shrink-0 whitespace-nowrap rounded-md px-1 text-[10px] font-semibold sm:inline",
                      selected ? "bg-white/25 text-white" : "bg-apple-mint/15 text-[#00857f]",
                    )}
                  >
                    오늘
                  </span>
                )}
                {dueCount > 0 && (
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md px-1 text-[10px] font-bold md:ml-auto",
                      selected ? "bg-white text-[#ff3b30]" : "bg-[#ff3b30] text-white",
                    )}
                  >
                    <Flag className="size-2.5" />
                    <span className="hidden lg:inline">마감</span> {dueCount}
                  </span>
                )}
              </div>

              {/* 종일 일정(연차·휴가·여행): 첫 일정을 칩으로, 나머지는 +N (모바일·PC 공통) */}
              {allDay.length > 0 && (
                <div className="mt-1 flex min-w-0 items-center gap-0.5" title={allDay.map((e) => `${e.emoji} ${e.title}`).join("\n")}>
                  <span
                    className={cn(
                      "flex min-w-0 items-center gap-0.5 rounded-md border px-1 py-px text-[10px] font-semibold leading-tight md:text-[11px]",
                      selected && "border-white/30 bg-white/20 text-white",
                    )}
                    style={selected ? undefined : allDayChipStyle(allDay[0].color)}
                  >
                    <span aria-hidden className="shrink-0">{allDay[0].emoji}</span>
                    <span className="min-w-0 truncate">{allDay[0].title}</span>
                  </span>
                  {allDay.length > 1 && (
                    <span className={cn("shrink-0 text-[10px] font-semibold", selected ? "text-white/80" : "text-ink-2")}>
                      +{allDay.length - 1}
                    </span>
                  )}
                </div>
              )}

              {/* 지정 시간 일정 (모바일에서는 공간만 차지) */}
              <div className={cn("min-h-0 min-w-0 flex-1 space-y-0.5 overflow-hidden max-md:invisible", allDay.length ? "mt-1" : "mt-1.5")}>
                {timedItems.slice(0, rows).map((t) => (
                  <div key={t.id} className="flex min-w-0 items-center gap-1 truncate text-[11px] leading-tight">
                    <span className={cn("size-1.5 shrink-0 rounded-full", selected ? "bg-white" : styleOf(t.category).dot)} />
                    <span className={cn("font-semibold tabular-nums", selected ? "text-white" : "text-ink")}>{shortTime(t.start_time)}</span>
                    <span className={cn("truncate", selected ? "text-white/85" : "text-ink-2", isDoneOn(t, iso) && "line-through")}>
                      {t.title}
                    </span>
                  </div>
                ))}
                {externalShown.map((e) => (
                  <ExternalEventRow key={e.id} event={e} color={sourceColors.get(e.sourceId)} inverted={selected} />
                ))}
                {external.length > externalShown.length && (
                  <div className={cn("truncate text-[10px]", selected ? "text-white/70" : "text-ink-2")}>
                    외부 일정 {external.length}건
                  </div>
                )}
                {items.length - Math.min(timedItems.length, rows) > 0 && (
                  <div className={cn("truncate text-[10px]", selected ? "text-white/70" : "text-ink-2")}>
                    {timedItems.length > rows ? `+${items.length - rows}건` : `시간 미지정 ${items.length - timedItems.length}건`}
                  </div>
                )}
              </div>

              <div className="flex min-w-0 items-center gap-1 md:gap-1.5">
                <div className={cn("h-1 min-w-0 flex-1 overflow-hidden rounded-full", selected ? "bg-white/25" : "bg-black/5")}>
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-300", selected ? "bg-white" : "bg-apple-mint")}
                    style={{ width: items.length ? `${(done / items.length) * 100}%` : 0 }}
                  />
                </div>
                <span className={cn("shrink-0 text-[10px] tabular-nums", selected ? "text-white/80" : "text-ink-2")}>
                  {items.length ? `${done}/${items.length}` : "–"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </GlassPanel>
  );
}

