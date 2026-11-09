"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightToLine, ChevronLeft, ChevronRight, Clock, Flag, TriangleAlert } from "lucide-react";
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
  weekdayIndex,
} from "@/lib/date";
import { isTodoDrag, readTodoDrag, startTodoDrag } from "@/lib/dnd";
import { CATEGORY_STYLE, type Todo } from "@/lib/types";
import { cn } from "@/lib/cn";
import { GlassButton, GlassPanel } from "@/components/ui/Glass";

const md = (iso: string) => {
  const d = parseISODate(iso);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_KO[weekdayIndex(iso)]})`;
};

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
  const selectedDate = useCockpit((s) => s.selectedDate);
  const setSelectedDate = useCockpit((s) => s.setSelectedDate);
  const todos = useCockpit((s) => s.todos);
  const dropToDate = useDropToDate();
  const [dragOver, setDragOver] = useState<string | null>(null);

  const days = weekDates(selectedDate);
  const today = todayISO();
  const first = parseISODate(days[0]);

  const perDay = days.map((iso) => ({ iso, items: todos.filter((t) => occursOn(t, iso)).sort(byTime) }));
  const weekItems = perDay.flatMap((d) => d.items.map((t) => ({ t, iso: d.iso })));
  const deadlines = weekItems.filter(({ t, iso }) => t.category === "마감" && !isDoneOn(t, iso));
  const timed = weekItems.filter(({ t }) => t.start_time).length;

  return (
    <GlassPanel className="relative z-20 flex shrink-0 flex-col gap-3 px-4 pb-4 pt-3">
      {/* 요약: 마감 · 이동 필요 · 지정 시간 */}
      <div className="flex items-center gap-2 pl-1 text-xs">
        <span className="text-[15px] font-semibold tracking-[-0.01em]">
          {first.getFullYear()}년 {first.getMonth() + 1}월
        </span>
        <div className="mr-2 flex">
          <GlassButton className="px-1.5 py-1" onClick={() => setSelectedDate(addDays(selectedDate, -7))} aria-label="이전 주">
            <ChevronLeft className="size-4" />
          </GlassButton>
          <GlassButton className="px-1.5 py-1" onClick={() => setSelectedDate(addDays(selectedDate, 7))} aria-label="다음 주">
            <ChevronRight className="size-4" />
          </GlassButton>
        </div>

        <SummaryPill tone="red" icon={<Flag className="size-3.5" />} label="마감" count={deadlines.length}>
          {deadlines.slice(0, 3).map(({ t, iso }) => (
            <button
              key={`${t.id}${iso}`}
              onClick={() => setSelectedDate(iso)}
              className="truncate rounded-md bg-white/70 px-1.5 py-0.5 font-medium text-[#c4271d] hover:bg-white"
            >
              {md(iso)} {t.title}
            </button>
          ))}
          {deadlines.length > 3 && <span className="text-ink-2">외 {deadlines.length - 3}건</span>}
        </SummaryPill>

        <OverduePill />

        <SummaryPill tone="blue" icon={<Clock className="size-3.5" />} label="시간 지정" count={timed}>
          <span className="text-ink-2">미지정 {weekItems.length - timed}건</span>
        </SummaryPill>
      </div>

      <div className="grid grid-cols-7 gap-2.5">
        {perDay.map(({ iso, items }, i) => {
          const done = items.filter((t) => isDoneOn(t, iso)).length;
          const dueCount = items.filter((t) => t.category === "마감" && !isDoneOn(t, iso)).length;
          const timedItems = items.filter((t) => t.start_time);
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
                "group relative flex h-[118px] flex-col rounded-xl border px-3 py-2 text-left",
                "transition-[background-color,box-shadow,transform,border-color] duration-200 active:scale-[0.98]",
                selected
                  ? "border-transparent bg-apple-blue text-white shadow-lg shadow-apple-blue/30"
                  : "border-white/50 bg-white/50 hover:bg-white/80",
                dragOver === iso && "ring-2 ring-apple-mint ring-offset-2",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "text-xs font-medium",
                    selected ? "text-white/80" : weekend ? "text-[#ff3b30]/80" : "text-ink-2",
                  )}
                >
                  {WEEKDAY_KO[i]}
                </span>
                <span className="text-[20px] font-semibold leading-none tracking-[-0.02em]">{parseISODate(iso).getDate()}</span>
                {isToday && (
                  <span
                    className={cn(
                      "rounded-md px-1 text-[10px] font-semibold",
                      selected ? "bg-white/25 text-white" : "bg-apple-mint/15 text-[#00857f]",
                    )}
                  >
                    오늘
                  </span>
                )}
                {dueCount > 0 && (
                  <span
                    className={cn(
                      "ml-auto flex items-center gap-0.5 rounded-md px-1 text-[10px] font-bold",
                      selected ? "bg-white text-[#ff3b30]" : "bg-[#ff3b30] text-white",
                    )}
                  >
                    <Flag className="size-2.5" />
                    마감 {dueCount}
                  </span>
                )}
              </div>

              {/* 지정 시간 일정 */}
              <div className="mt-1.5 min-h-0 flex-1 space-y-0.5 overflow-hidden">
                {timedItems.slice(0, 2).map((t) => (
                  <div key={t.id} className="flex items-center gap-1 truncate text-[11px] leading-tight">
                    <span className={cn("size-1.5 shrink-0 rounded-full", selected ? "bg-white" : CATEGORY_STYLE[t.category].dot)} />
                    <span className={cn("font-semibold tabular-nums", selected ? "text-white" : "text-ink")}>{shortTime(t.start_time)}</span>
                    <span className={cn("truncate", selected ? "text-white/85" : "text-ink-2", isDoneOn(t, iso) && "line-through")}>
                      {t.title}
                    </span>
                  </div>
                ))}
                {items.length - Math.min(timedItems.length, 2) > 0 && (
                  <div className={cn("text-[10px]", selected ? "text-white/70" : "text-ink-2")}>
                    {timedItems.length > 2 ? `+${items.length - 2}건` : `시간 미지정 ${items.length - timedItems.length}건`}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <div className={cn("h-1 flex-1 overflow-hidden rounded-full", selected ? "bg-white/25" : "bg-black/5")}>
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-300", selected ? "bg-white" : "bg-apple-mint")}
                    style={{ width: items.length ? `${(done / items.length) * 100}%` : 0 }}
                  />
                </div>
                <span className={cn("text-[10px] tabular-nums", selected ? "text-white/80" : "text-ink-2")}>
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

function SummaryPill({
  tone,
  icon,
  label,
  count,
  children,
}: {
  tone: "red" | "blue";
  icon: React.ReactNode;
  label: string;
  count: number;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1",
        tone === "red" ? "bg-[#ff3b30]/8 text-[#c4271d]" : "bg-apple-blue/8 text-[#0062cc]",
      )}
    >
      {icon}
      <span className="font-semibold">
        {label} {count}
      </span>
      {count > 0 && <div className="flex min-w-0 items-center gap-1">{children}</div>}
    </div>
  );
}

/** 이동 필요: 지난 날짜의 미완료 일정. 클릭하면 목록 + 오늘로 옮기기 */
function OverduePill() {
  const overdue = useCockpit((s) => s.overdue);
  const moveTodoToDate = useCockpit((s) => s.moveTodoToDate);
  const setSelectedDate = useCockpit((s) => s.setSelectedDate);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const today = todayISO();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={overdue.length === 0}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-2 py-1 font-semibold transition-colors",
          overdue.length ? "bg-[#ff9500]/12 text-[#b86b00] hover:bg-[#ff9500]/20" : "bg-black/[0.04] text-ink-2",
        )}
        aria-expanded={open}
      >
        <TriangleAlert className="size-3.5" />
        이동 필요 {overdue.length}
      </button>

      {open && overdue.length > 0 && (
        <div className="absolute left-0 top-9 z-50 w-[380px] rounded-xl border border-white/40 bg-white/90 p-2 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <span className="text-xs text-ink-2">지난 날짜의 미완료 일정 · 날짜 칸으로 끌어다 놓아도 돼요</span>
            <GlassButton
              variant="primary"
              className="px-2 py-1 text-xs"
              onClick={() => {
                overdue.forEach((t) => void moveTodoToDate(t, today));
                setOpen(false);
              }}
            >
              모두 오늘로
            </GlassButton>
          </div>
          <ul className="max-h-72 space-y-0.5 overflow-y-auto scroll-thin">
            {overdue.map((t) => (
              <li
                key={t.id}
                draggable
                onDragStart={(e) => startTodoDrag(e, t)}
                className="flex cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[0.04]"
              >
                <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", CATEGORY_STYLE[t.category].badge)}>
                  {t.category}
                </span>
                <button
                  className="min-w-0 flex-1 truncate text-left text-sm"
                  onClick={() => {
                    setSelectedDate(t.date);
                    setOpen(false);
                  }}
                >
                  {t.title}
                </button>
                <span className="shrink-0 text-xs tabular-nums text-[#b86b00]">{md(t.date)}</span>
                <button
                  onClick={() => void moveTodoToDate(t, today)}
                  className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-apple-blue hover:bg-apple-blue/10"
                >
                  <ArrowRightToLine className="size-3" />
                  오늘
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
