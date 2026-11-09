"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Loader2, Repeat as RepeatIcon, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCockpit } from "@/store/cockpit";
import { WEEKDAY_KO, isDoneOn, shortTime, timeToMinutes, weekdayIndex } from "@/lib/date";
import { searchFilter } from "@/lib/search";
import { REPEAT_LABEL, normalizeTodo, type Todo } from "@/lib/types";
import { cn } from "@/lib/cn";
import { CategoryBadge, GlassButton, GlassPanel, Kbd, TagChip } from "@/components/ui/Glass";
import { DateRangeBar } from "./DateRangeBar";
import { PrintButton, PrintHeader } from "./Print";

const MAX_ROWS = 2000;
type Sort = "desc" | "asc";

const fmtDate = (iso: string) => `${iso.replaceAll("-", ".")} (${WEEKDAY_KO[weekdayIndex(iso)]})`;

/** 검색어 강조 */
function Highlight({ text, term }: { text: string; term: string }) {
  const t = term.replace(/^#/, "").trim();
  if (!t) return <>{text}</>;
  const parts = text.split(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === t.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-[#ffcc00]/40 px-px text-inherit">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * 검색 결과 전용 뷰 (중앙 영역 전체).
 * - 검색어 + 기간으로 서버 재조회, 검색어가 비면 기간 내 전체 내역
 * - 행 클릭: 하단 상세 패널 열기 · 더블클릭: 해당 날짜 일간 보기로 이동
 */
export function SearchView() {
  const query = useCockpit((s) => s.searchQuery);
  const range = useCockpit((s) => s.searchRange);
  const setRange = useCockpit((s) => s.setSearchRange);
  const rev = useCockpit((s) => s.rev);
  const userId = useCockpit((s) => s.userId);
  const closeSearch = useCockpit((s) => s.closeFullView);
  const ensureTodo = useCockpit((s) => s.ensureTodo);
  const selectTodo = useCockpit((s) => s.selectTodo);
  const selectedTodoId = useCockpit((s) => s.selectedTodoId);
  const setView = useCockpit((s) => s.setView);
  const setSelectedDate = useCockpit((s) => s.setSelectedDate);
  // 상세 패널에서 수정한 내용이 바로 보이도록 로드된 최신 값을 우선 사용
  const liveTodos = useCockpit((s) => s.todos);

  const [results, setResults] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("desc");
  const [term, setTerm] = useState(query.trim());

  // 검색어는 입력이 멈추면 반영 (기간 변경은 즉시)
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      let req = createClient()
        .from("todos")
        .select("*")
        .eq("user_id", userId ?? "")
        // 단일 일정은 기간 내, 반복 일정은 기간 종료일 이전에 시작한 것
        .or(
          `and(repeat.eq.none,date.gte.${range.start},date.lte.${range.end}),and(repeat.neq.none,date.lte.${range.end})`,
        );
      const f = searchFilter(term);
      if (f) req = req.or(f); // 여러 or()는 AND로 결합됨
      const { data, error } = await req.order("date", { ascending: false }).limit(MAX_ROWS);
      if (cancelled) return;
      setError(error?.message ?? null);
      setResults((data ?? []).map(normalizeTodo));
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [term, range.start, range.end, rev, userId]);

  const rows = useMemo(() => {
    const live = new Map(liveTodos.map((t) => [t.id, t]));
    const merged = results.map((r) => live.get(r.id) ?? r);
    const dir = sort === "desc" ? -1 : 1;
    return merged.sort(
      (a, b) =>
        dir * a.date.localeCompare(b.date) ||
        dir * ((timeToMinutes(a.start_time) ?? -1) - (timeToMinutes(b.start_time) ?? -1)),
    );
  }, [results, liveTodos, sort]);

  function open(t: Todo) {
    ensureTodo(t);
    selectTodo(selectedTodoId === t.id ? null : t.id);
  }

  function goToDay(t: Todo) {
    setView("day");
    setSelectedDate(t.date);
  }

  return (
    <GlassPanel data-print-root className="flex h-[calc(100dvh-140px)] min-h-[520px] min-w-0 flex-col overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1 print:block print:overflow-visible print:rounded-none print:border-0">
      {/* 상단: 제목 + 기간 컨트롤 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-black/5 px-4 py-3 sm:px-6 sm:py-3.5 print:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Search className="size-5 shrink-0 text-apple-blue" />
          <h2 className="min-w-0 truncate text-[17px] font-semibold tracking-[-0.01em] sm:text-[19px]">
            {term ? (
              <>
                ‘<span className="text-apple-blue">{term}</span>’ 검색 결과
              </>
            ) : (
              "기간 전체 내역"
            )}
          </h2>
          <span className="shrink-0 whitespace-nowrap rounded-md bg-black/5 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-2">
            {loading ? <Loader2 className="inline size-3 animate-spin" /> : `${rows.length}${rows.length >= MAX_ROWS ? "+" : ""}건`}
          </span>
        </div>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <DateRangeBar range={range} onChange={setRange} />
          <GlassButton
            onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))}
            className="text-xs"
            title="정렬 순서 전환"
          >
            {sort === "desc" ? <ArrowDownWideNarrow className="size-4" /> : <ArrowUpNarrowWide className="size-4" />}
            {sort === "desc" ? "최근순" : "날짜순"}
          </GlassButton>
          <PrintButton fileName={`검색_${term || "전체"}_${range.start}_${range.end}`} disabled={!rows.length} />
          <GlassButton onClick={closeSearch} className="text-xs" title="검색 닫기 (Esc)">
            <X className="size-4" />
            <span className="whitespace-nowrap">닫기</span> <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </GlassButton>
        </div>
      </div>

      <PrintHeader
        title={term ? `검색 결과 · ‘${term}’` : "기간 전체 내역"}
        range={range}
        meta={`${rows.length}건 · ${sort === "desc" ? "최근순" : "날짜순"}`}
      />

      {/* 결과 테이블: 날짜 | 시간 | 업무 | 태그 */}
      <div data-print-keep-next className="grid grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[120px_96px_minmax(0,1fr)_minmax(0,200px)] xl:grid-cols-[150px_120px_minmax(0,1fr)_minmax(0,300px)] gap-4 print:grid-cols-[100px_76px_minmax(0,1fr)_150px] print:gap-2.5 print:px-0 print:text-[9.5pt] print:border-black border-b border-black/5 bg-white/40 px-4 py-2 text-xs font-semibold text-ink-2 sm:px-6">
        <span>날짜</span>
        <span className="hidden md:block print:block">시간</span>
        <span>업무</span>
        <span className="hidden md:block print:block">태그</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin print:overflow-visible">
        {error ? (
          <p className="p-8 text-center text-sm text-[#c4271d]">{error}</p>
        ) : !loading && rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-ink-2">
            <p className="font-medium text-ink">{term ? `‘${term}’에 해당하는 할 일이 없어요` : "이 기간에 등록된 할 일이 없어요"}</p>
            <p>상단에서 조회 기간을 넓혀 보세요 (예: 작년).</p>
          </div>
        ) : (
          <ul className={cn("px-3 py-1.5 transition-opacity print:p-0", loading && "opacity-60")}>
            {rows.map((t, i) => {
              const month = t.date.slice(0, 7);
              // 이전 행과 월이 다르면 월 구분선
              const header = i === 0 || rows[i - 1].date.slice(0, 7) !== month;
              const done = t.repeat === "none" && isDoneOn(t, t.date);
              const selected = t.id === selectedTodoId;
              return (
                <Fragment key={t.id}>
                  {header && (
                    <li data-print-keep-next className="px-3 pb-1 pt-3 text-[11px] font-semibold text-ink-2 print:px-0 print:pb-1.5 print:pt-4 print:text-[9.5pt]">
                      {month.slice(0, 4)}년 {Number(month.slice(5))}월
                    </li>
                  )}
                  <li data-print-avoid>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => open(t)}
                      onDoubleClick={() => goToDay(t)}
                      onKeyDown={(e) => e.key === "Enter" && open(t)}
                      title="클릭: 상세 보기 · 더블클릭: 해당 날짜로 이동"
                      className={cn(
                        "grid cursor-pointer grid-cols-[92px_minmax(0,1fr)] md:grid-cols-[120px_96px_minmax(0,1fr)_minmax(0,200px)] xl:grid-cols-[150px_120px_minmax(0,1fr)_minmax(0,300px)] items-center gap-4 rounded-lg print:grid-cols-[100px_76px_minmax(0,1fr)_150px] print:gap-2.5 print:px-0 print:text-[9.5pt] print:items-start print:rounded-none print:border-b print:border-dotted print:py-1.5 px-3 py-2.5 text-sm outline-none",
                        "transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-apple-blue/40",
                        selected ? "bg-apple-blue/[0.08] ring-1 ring-apple-blue/30" : "hover:bg-white/70",
                      )}
                    >
                      <span className="min-w-0 truncate tabular-nums text-ink">
                        {t.repeat === "none" ? (
                          fmtDate(t.date)
                        ) : (
                          <span className="flex items-center gap-1 text-apple-blue">
                            <RepeatIcon className="size-3.5" />
                            {REPEAT_LABEL[t.repeat]}
                            <span className="text-xs text-ink-2">({t.date.slice(5).replace("-", "/")}~)</span>
                          </span>
                        )}
                      </span>
                      <span className="hidden whitespace-nowrap tabular-nums text-ink-2 md:block print:block">
                        {t.start_time ? `${shortTime(t.start_time)}${t.end_time ? `–${shortTime(t.end_time)}` : ""}` : "—"}
                      </span>
                      <span className={cn("truncate font-medium", done && "text-ink-2 line-through")}>
                        <Highlight text={t.title} term={term} />
                      </span>
                      <span className="hidden min-w-0 items-center gap-1 overflow-hidden md:flex print:flex print:flex-wrap print:overflow-visible">
                        <CategoryBadge category={t.category} />
                        {t.tags.map((tag) => (
                          <TagChip key={tag} tag={tag} className="shrink-0" />
                        ))}
                      </span>
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>
    </GlassPanel>
  );
}
