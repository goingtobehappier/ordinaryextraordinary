"use client";

import { useMemo, useState } from "react";
import { ListChecks, Loader2, Plus } from "lucide-react";
import { DEFAULT_TAG, useCockpit } from "@/store/cockpit";
import { formatLong, isDoneOn, occursOn, timeToMinutes, todayISO } from "@/lib/date";
import { DEFAULT_CATEGORY } from "@/lib/types";
import { cn } from "@/lib/cn";
import { GlassInput, GlassPanel } from "@/components/ui/Glass";
import { TodoList } from "./TodoBoard";

/**
 * 월간 보기 우측 상단: 달력에서 선택한 날짜의 과업 리스트 (타임블록 없음)
 * - 항목 클릭 → 좌측 하단 상세 패널, 달력의 다른 날짜로 끌어 옮기기 가능
 * - 간단 추가: 제목만 입력 후 Enter (시간·태그는 상세 패널에서 편집)
 */
export function DayTaskPanel({ className }: { className?: string }) {
  const selectedDate = useCockpit((s) => s.selectedDate);
  const allTodos = useCockpit((s) => s.todos);
  const loading = useCockpit((s) => s.loading);
  const addTodo = useCockpit((s) => s.addTodo);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const dayTodos = useMemo(
    () =>
      allTodos
        .filter((t) => occursOn(t, selectedDate))
        .sort(
          (a, b) =>
            (timeToMinutes(a.start_time) ?? 9999) - (timeToMinutes(b.start_time) ?? 9999) ||
            a.created_at.localeCompare(b.created_at),
        ),
    [allTodos, selectedDate],
  );
  const doneCount = dayTodos.filter((t) => isDoneOn(t, selectedDate)).length;

  async function submit() {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    const created = await addTodo({
      title: t,
      category: DEFAULT_CATEGORY,
      date: selectedDate,
      start_time: null,
      end_time: null,
      tags: [DEFAULT_TAG],
      repeat: "none",
    });
    setSaving(false);
    if (created) setTitle("");
  }

  return (
    <GlassPanel className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden print:hidden", className)}>
      <div className="flex items-center gap-3 border-b border-black/5 px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-apple-blue/10">
          <ListChecks className="size-[18px] text-apple-blue" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">
            Task List
            {selectedDate === todayISO() && <span className="ml-1.5 text-xs font-medium text-apple-blue">오늘</span>}
          </h2>
          <p className="truncate text-xs text-ink-2">{formatLong(selectedDate)}</p>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-ink-2">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : `${doneCount}/${dayTodos.length} 완료`}
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="border-b border-black/5 px-4 py-2.5"
      >
        <div className="relative">
          {saving ? (
            <Loader2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-apple-blue" />
          ) : (
            <Plus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-apple-blue" />
          )}
          <GlassInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
            placeholder="이 날짜에 할 일 추가 → Enter"
            className="w-full pl-9"
            maxLength={300}
            autoComplete="off"
            aria-label="선택한 날짜에 할 일 추가"
          />
        </div>
      </form>

      <TodoList
        todos={dayTodos}
        date={selectedDate}
        emptyFiltered={false}
        compact
        emptyHint="위 입력창에서 추가하거나, 달력 날짜를 더블클릭해 일간 보기로 여세요."
        className="flex-1"
      />
    </GlassPanel>
  );
}
