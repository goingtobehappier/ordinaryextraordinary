"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ClipboardCopy,
  ListTree,
  Loader2,
  NotebookPen,
  TriangleAlert,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCockpit } from "@/store/cockpit";
import { WEEKDAY_KO, isDoneOn, occursOn, timeToMinutes, weekdayIndex } from "@/lib/date";
import { normalizeTodo, type Category, type Todo } from "@/lib/types";
import { isMissingColumn, toSubtasks, type Detail } from "@/lib/todoDetails";
import { cn } from "@/lib/cn";
import { GlassButton, GlassPanel, Kbd } from "@/components/ui/Glass";
import { DateRangeBar } from "./DateRangeBar";
import { Markdown } from "./Markdown";
import { PrintButton, PrintHeader } from "./Print";

type DayItem = { todo: Todo; done: boolean };
type Day = { date: string; items: DayItem[]; note: string };
type Sort = "desc" | "asc";

/** 헤더 집계에 표시할 1차 태그 순서 */
const COUNT_ORDER: Category[] = ["마감", "미팅", "회의", "보고", "일정", "업무"];
const SEP = "｜";

/** [2026년 11월 09일 월요일] */
function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-");
  return `[${y}년 ${m}월 ${d}일 ${WEEKDAY_KO[weekdayIndex(iso)]}요일]`;
}

function dayCounts(day: Day): string[] {
  const done = day.items.filter((i) => i.done).length;
  const parts = [`완료 ${done}건`];
  for (const c of COUNT_ORDER) {
    const n = day.items.filter((i) => i.todo.category === c).length;
    if (n) parts.push(`${c} ${n}건`);
  }
  return parts;
}

/** 기간 내 할 일 + 상세(메모·하위 작업) + 데일리 노트. 레거시 컬럼(sub_tasks, note_date)도 대비 */
async function fetchSummary(userId: string, start: string, end: string) {
  const sb = createClient();
  const warnings: string[] = [];

  const todosReq = sb
    .from("todos")
    .select("*")
    .eq("user_id", userId)
    .or(`and(repeat.eq.none,date.gte.${start},date.lte.${end}),and(repeat.neq.none,date.lte.${end})`)
    .limit(5000);

  // 상세: subtasks 컬럼이 없으면 레거시 sub_tasks로 재시도
  const detailsReq = (async () => {
    const r = await sb.from("todo_details").select("todo_id, memo, subtasks").eq("user_id", userId).limit(10000);
    if (!isMissingColumn(r.error)) return r;
    warnings.push("todo_details.subtasks");
    return sb.from("todo_details").select("todo_id, memo, subtasks:sub_tasks").eq("user_id", userId).limit(10000);
  })();

  // 데일리 노트: date 컬럼이 없으면 레거시 note_date로 재시도
  const notesReq = (async () => {
    const r = await sb.from("daily_notes").select("date, content").eq("user_id", userId).gte("date", start).lte("date", end);
    if (!isMissingColumn(r.error)) return r;
    warnings.push("daily_notes.date");
    return sb.from("daily_notes").select("date:note_date, content").eq("user_id", userId).gte("note_date", start).lte("note_date", end);
  })();

  const [todosRes, detailsRes, notesRes] = await Promise.all([todosReq, detailsReq, notesReq]);
  if (todosRes.error) throw new Error(todosRes.error.message);

  const details = new Map<string, Detail>();
  for (const d of (detailsRes.data ?? []) as { todo_id: string; memo: string | null; subtasks: unknown }[]) {
    details.set(d.todo_id, { memo: d.memo ?? "", subtasks: toSubtasks(d.subtasks) });
  }
  const notes = new Map<string, string>();
  for (const n of (notesRes.data ?? []) as { date: string; content: string | null }[]) {
    if (n.content?.trim()) notes.set(String(n.date).slice(0, 10), n.content);
  }
  return { todos: (todosRes.data ?? []).map(normalizeTodo), details, notes, warnings };
}

/** 날짜별로 묶기. 반복 일정은 완료한 날에만 기록으로 포함 */
function buildDays(todos: Todo[], notes: Map<string, string>, start: string, end: string): Map<string, Day> {
  const days = new Map<string, Day>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) days.set(date, (d = { date, items: [], note: "" }));
    return d;
  };
  for (const t of todos) {
    if (t.repeat === "none") {
      if (t.date >= start && t.date <= end) day(t.date).items.push({ todo: t, done: isDoneOn(t, t.date) });
    } else {
      for (const cd of t.completed_dates) {
        if (cd >= start && cd <= end && occursOn(t, cd)) day(cd).items.push({ todo: t, done: true });
      }
    }
  }
  notes.forEach((content, date) => (day(date).note = content));
  days.forEach((d) =>
    d.items.sort(
      (a, b) =>
        (timeToMinutes(a.todo.start_time) ?? 9999) - (timeToMinutes(b.todo.start_time) ?? 9999) ||
        a.todo.created_at.localeCompare(b.todo.created_at),
    ),
  );
  return days;
}

/** 화면과 동일한 계층 구조의 텍스트 (보고용 복사) */
function toPlainText(days: Day[], details: Map<string, Detail>) {
  return days
    .map((d) => {
      const lines = [[dayLabel(d.date), ...dayCounts(d)].join(SEP)];
      for (const { todo } of d.items) {
        const memo = details.get(todo.id)?.memo.trim();
        lines.push(memo ? `${todo.title} ${SEP} ${memo.replace(/\s*\n\s*/g, " / ")}` : todo.title);
        for (const s of details.get(todo.id)?.subtasks ?? []) lines.push(`  - ${s.text}`);
      }
      if (d.note.trim()) lines.push("", "당일메모", d.note.trim());
      lines.push("-".repeat(40));
      return lines.join("\n");
    })
    .join("\n");
}

/**
 * 요약 계층 뷰: 날짜 → 메인 업무(｜메모) → 하위 업무 → 당일메모 → 구분선.
 * 업무 클릭 → 수정 모달, 당일메모 클릭 → 우측 Daily Memopad를 해당 날짜로.
 */
export function SummaryView() {
  const range = useCockpit((s) => s.summaryRange);
  const setRange = useCockpit((s) => s.setSummaryRange);
  const rev = useCockpit((s) => s.rev);
  const userId = useCockpit((s) => s.userId);
  const closeView = useCockpit((s) => s.closeFullView);
  const ensureTodo = useCockpit((s) => s.ensureTodo);
  const selectTodo = useCockpit((s) => s.selectTodo);
  const setSelectedDate = useCockpit((s) => s.setSelectedDate);
  const selectedDate = useCockpit((s) => s.selectedDate);
  const liveTodos = useCockpit((s) => s.todos);

  const [data, setData] = useState<Awaited<ReturnType<typeof fetchSummary>> | null>(null);
  // 마지막으로 응답을 받은 요청 키 — 현재 키와 다르면 로딩 중
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("desc");
  const [copied, setCopied] = useState(false);

  const requestKey = `${userId}_${range.start}_${range.end}_${rev}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    fetchSummary(userId, range.start, range.end)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoadedKey(requestKey));
    return () => {
      cancelled = true;
    };
  }, [userId, range.start, range.end, requestKey]);

  const days = useMemo(() => {
    if (!data) return [];
    // 모달에서 수정한 값이 바로 보이도록 스토어의 최신 값을 우선
    const live = new Map(liveTodos.map((t) => [t.id, t]));
    const todos = data.todos.map((t) => live.get(t.id) ?? t);
    const list = [...buildDays(todos, data.notes, range.start, range.end).values()];
    return list.sort((a, b) => (sort === "desc" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  }, [data, liveTodos, range.start, range.end, sort]);

  const totals = useMemo(() => {
    const items = days.flatMap((d) => d.items);
    return { tasks: items.length, done: items.filter((i) => i.done).length, notes: days.filter((d) => d.note).length };
  }, [days]);

  function openTask(todo: Todo) {
    ensureTodo(todo);
    selectTodo(todo.id);
  }

  async function copyText() {
    if (!data) return;
    await navigator.clipboard.writeText(toPlainText(days, data.details));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <GlassPanel data-print-root className="flex h-[calc(100dvh-140px)] min-h-[520px] min-w-0 flex-col overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1 print:block print:overflow-visible print:rounded-none print:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-black/5 px-4 py-3 sm:px-6 sm:py-3.5 print:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <ListTree className="size-5 shrink-0 text-apple-blue" />
          <h2 className="shrink-0 text-[17px] font-semibold tracking-[-0.01em] sm:text-[19px]">요약</h2>
          <span className="min-w-0 truncate rounded-md bg-black/5 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-2">
            {loading && !data ? (
              <Loader2 className="inline size-3 animate-spin" />
            ) : (
              `${days.length}일 · 업무 ${totals.tasks}건 · 완료 ${totals.done}건 · 메모 ${totals.notes}일`
            )}
          </span>
          {loading && data && <Loader2 className="size-4 animate-spin text-ink-2" />}
        </div>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <DateRangeBar range={range} onChange={setRange} />
          <GlassButton onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))} className="text-xs" title="정렬 순서 전환">
            {sort === "desc" ? <ArrowDownWideNarrow className="size-4" /> : <ArrowUpNarrowWide className="size-4" />}
            {sort === "desc" ? "최근순" : "날짜순"}
          </GlassButton>
          <GlassButton onClick={copyText} className="text-xs" disabled={!days.length} title="계층 구조 그대로 텍스트로 복사">
            {copied ? <Check className="size-4 text-apple-mint" /> : <ClipboardCopy className="size-4" />}
            {copied ? "복사됨" : "텍스트 복사"}
          </GlassButton>
          <PrintButton fileName={`요약_${range.start}_${range.end}`} disabled={!days.length} />
          <GlassButton onClick={closeView} className="text-xs" title="요약 닫기 (Esc)">
            <X className="size-4" />
            <span className="whitespace-nowrap">닫기</span> <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </GlassButton>
        </div>
      </div>

      <PrintHeader
        title="업무 요약"
        range={range}
        meta={`${days.length}일 · 업무 ${totals.tasks}건 · 완료 ${totals.done}건`}
      />

      {data && data.warnings.length > 0 && (
        <p className="flex items-center gap-2 border-b border-black/5 print:hidden bg-[#ff9500]/10 px-6 py-2 text-xs text-[#a35f00]">
          <TriangleAlert className="size-3.5 shrink-0" />
          DB에 {data.warnings.join(", ")} 컬럼이 없어 기존 컬럼으로 읽었습니다. 하위 작업·당일메모 저장을 위해
          supabase/migrations/004_details_notes_columns.sql 을 실행하세요.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-left scroll-thin print:overflow-visible print:p-0">
        {error ? (
          <p className="p-8 text-center text-sm text-[#c4271d]">{error}</p>
        ) : !loading && days.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-ink-2">
            <p className="font-medium text-ink">이 기간에 기록된 업무나 메모가 없어요</p>
            <p>상단에서 조회 기간을 조정해 보세요.</p>
          </div>
        ) : (
          <div className={cn("w-full max-w-none text-left transition-opacity", loading && "opacity-60")}>
            {days.map((d) => (
              <section key={d.date} data-print-card className="py-4 print:py-0">
                {/* [날짜]｜완료｜1차 태그별 건수 */}
                <h3 data-print-keep-next className="flex flex-wrap items-center justify-start gap-x-1 print:text-[11.5pt] text-left text-[15px] font-bold tracking-[-0.01em]">
                  <button
                    onClick={() => setSelectedDate(d.date)}
                    className={cn("rounded-md hover:text-apple-blue", d.date === selectedDate && "text-apple-blue")}
                    title="우측 Daily Memopad를 이 날짜로"
                  >
                    {dayLabel(d.date)}
                  </button>
                  {dayCounts(d).map((c, i) => (
                    <span key={c} className={cn("font-semibold", i === 0 ? "text-[#00857f]" : "text-ink-2")}>
                      <span className="mx-1 font-normal text-ink-2/50">{SEP}</span>
                      {c}
                    </span>
                  ))}
                </h3>

                {/* 메인 업무 ｜ 업무메모 → 하위 업무 */}
                <ul className="mt-2.5 space-y-1.5">
                  {d.items.map(({ todo, done }) => {
                    const detail = data?.details.get(todo.id);
                    const memo = detail?.memo.trim();
                    return (
                      <li key={`${todo.id}${d.date}`} data-print-avoid>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => openTask(todo)}
                          onKeyDown={(e) => e.key === "Enter" && openTask(todo)}
                          title="클릭하여 수정"
                          className="-mx-2 cursor-pointer rounded-lg px-2 py-1 outline-none print:mx-0 print:px-0 transition-colors hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-apple-blue/40"
                        >
                          <p className="text-[14px] leading-relaxed">
                            <span className={cn("font-semibold", done && "text-ink-2 line-through decoration-ink-2/50")}>
                              {todo.title}
                            </span>
                            {memo && (
                              <>
                                <span className="mx-1.5 text-ink-2/50">{SEP}</span>
                                <span className="whitespace-pre-line text-ink-2">{memo}</span>
                              </>
                            )}
                          </p>
                          {detail && detail.subtasks.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5 pl-5">
                              {detail.subtasks.map((s) => (
                                <li key={s.id} className={cn("text-[13px] text-ink-2", s.done && "line-through decoration-ink-2/40")}>
                                  - {s.text}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* 당일메모 */}
                {d.note && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedDate(d.date)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedDate(d.date)}
                    data-print-avoid
                    title="클릭하면 우측 Daily Memopad에서 편집"
                    className="-mx-2 mt-4 cursor-pointer rounded-lg px-2 py-1.5 outline-none print:mx-0 print:px-0 transition-colors hover:bg-white/70"
                  >
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#00857f]">
                      <NotebookPen className="size-3.5" />
                      당일메모
                    </p>
                    <div className="mt-1 text-ink-2 [&_*]:text-[13.5px]">
                      <Markdown source={d.note} />
                    </div>
                  </div>
                )}

                {/* 날짜 구분선 */}
                <div className="mt-5 w-full border-t border-dashed border-black/15 print:mt-3" />
              </section>
            ))}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}

