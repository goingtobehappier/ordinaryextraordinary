"use client";

import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { eventsOn, useCalendar } from "@/store/calendar";
import type { CalendarEvent } from "@/lib/calendar/types";
import { cn } from "@/lib/cn";

const FALLBACK_COLOR = "#8e44ad";

/** 소스 id → 색상 */
export function useSourceColors() {
  const sources = useCalendar((s) => s.sources);
  return useMemo(() => new Map(sources.map((s) => [s.id, s.color])), [sources]);
}

/** 날짜별 외부 일정 */
export function useExternalEvents(date: string) {
  const events = useCalendar((s) => s.events);
  return useMemo(() => eventsOn(events, date), [events, date]);
}

/** 날짜 → 외부 일정 목록 조회 함수 (주간·월간 그리드용) */
export function useExternalEventsByDate() {
  const events = useCalendar((s) => s.events);
  return useMemo(() => {
    const byDate = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = byDate.get(e.date);
      if (list) list.push(e);
      else byDate.set(e.date, [e]);
    }
    return (date: string) => (byDate.has(date) ? eventsOn(byDate.get(date)!, date) : []);
  }, [events]);
}

export const eventTimeLabel = (e: CalendarEvent) => (e.allDay ? "종일" : `${e.start}${e.end ? `–${e.end}` : ""}`);

export function eventTooltip(e: CalendarEvent, sourceName?: string) {
  return [e.title, eventTimeLabel(e), e.location, sourceName && `외부 캘린더 · ${sourceName}`].filter(Boolean).join("\n");
}

/** 일간/주간 보드 상단: 선택 날짜의 외부 일정 칩 (읽기 전용) */
export function ExternalEventStrip({ date }: { date: string }) {
  const events = useExternalEvents(date);
  const colors = useSourceColors();
  const sources = useCalendar((s) => s.sources);
  const setOpen = useCalendar((s) => s.setModalOpen);
  if (!events.length) return null;
  const nameOf = (id: string) => sources.find((s) => s.id === id)?.name;

  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-black/5 px-4 py-2 scroll-thin sm:px-6">
      <button
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1 rounded-md px-1 text-xs font-medium text-ink-2 hover:bg-black/5"
        title="외부 캘린더 연동 설정"
      >
        <CalendarDays className="size-3.5" />
        외부 {events.length}
      </button>
      {events.map((e) => {
        const color = colors.get(e.sourceId) ?? FALLBACK_COLOR;
        return (
          <span
            key={e.id}
            title={eventTooltip(e, nameOf(e.sourceId))}
            className="flex max-w-[260px] shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs"
            style={{ borderColor: `${color}40`, background: `${color}12`, color }}
          >
            <span className="shrink-0 font-semibold tabular-nums">{eventTimeLabel(e)}</span>
            <span className="truncate text-ink">{e.title}</span>
          </span>
        );
      })}
    </div>
  );
}

/** 주간 카드·월간 칸 안의 한 줄 */
export function ExternalEventRow({ event, color, inverted, className }: { event: CalendarEvent; color?: string; inverted?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1 truncate text-[11px] leading-tight", className)} title={eventTooltip(event)}>
      <span
        className="size-1.5 shrink-0 rounded-[2px]"
        style={{ background: inverted ? "white" : (color ?? FALLBACK_COLOR) }}
      />
      {!event.allDay && <span className={cn("font-semibold tabular-nums", inverted ? "text-white" : "text-ink")}>{event.start}</span>}
      <span className={cn("truncate italic", inverted ? "text-white/85" : "text-ink-2")}>{event.title}</span>
    </div>
  );
}
