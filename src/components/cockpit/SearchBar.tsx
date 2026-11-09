"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Loader2, Repeat, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCockpit } from "@/store/cockpit";
import { formatLong, shortTime } from "@/lib/date";
import { formatCombo } from "@/hooks/useHotkeys";
import { cn } from "@/lib/cn";
import { normalizeTodo, type Todo } from "@/lib/types";
import { searchFilter } from "@/lib/search";
import { CategoryBadge, Kbd, TagChip } from "@/components/ui/Glass";

export const SEARCH_INPUT_ID = "cockpit-search";

/** 제목·태그로 내 할 일 전체를 검색 (RLS로 본인 데이터만 조회됨) */
export function SearchBar() {
  const query = useCockpit((s) => s.searchQuery);
  const setQuery = useCockpit((s) => s.setSearchQuery);
  const combo = useCockpit((s) => s.shortcuts.focusSearch);
  const setSelectedDate = useCockpit((s) => s.setSelectedDate);
  const selectTodo = useCockpit((s) => s.selectTodo);
  const openSearch = useCockpit((s) => s.openSearch);
  const userId = useCockpit((s) => s.userId);
  const inSearchView = useCockpit((s) => s.view === "search");

  const [results, setResults] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // -1 = 미리보기 항목 미선택 → Enter 시 검색 결과 뷰로 전환
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const term = query.trim();

  useEffect(() => {
    if (!term || !userId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      const f = searchFilter(term);
      if (!f) return setLoading(false);
      const { data } = await createClient()
        .from("todos")
        .select("*")
        .eq("user_id", userId)
        .or(f)
        .order("date", { ascending: false })
        .limit(8);
      if (!cancelled) {
        setResults((data ?? []).map(normalizeTodo));
        setActive(-1);
        setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, userId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pick(todo: Todo) {
    setSelectedDate(todo.date);
    selectTodo(todo.id);
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  const visible = term ? results : [];

  return (
    <div ref={wrapRef} className="relative w-[440px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" />
      <input
        id={SEARCH_INPUT_ID}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, visible.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, -1));
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            // ↑↓로 고른 미리보기 항목이 있으면 바로 열고, 아니면 중앙 검색 결과 뷰로 전환
            if (visible[active]) pick(visible[active]);
            else {
              openSearch();
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            // 결과 드롭다운이 열려 있으면 그것만 닫고 선택 해제(ESC)는 막음
            if (open && term) e.stopPropagation();
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        placeholder="할 일 · #태그 검색 (Enter: 전체 결과)"
        className="h-10 w-full rounded-lg border border-black/5 bg-black/[0.04] pl-9 pr-20 text-sm outline-none transition-[background-color,box-shadow] placeholder:text-ink-2/70 focus:bg-white/90 focus:ring-2 focus:ring-apple-blue/40"
        autoComplete="off"
      />
      <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {query ? (
          <button
            onClick={() => setQuery("")}
            className="rounded-md p-1 text-ink-2 hover:bg-black/5"
            aria-label="검색어 지우기"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          formatCombo(combo).map((k) => <Kbd key={k}>{k}</Kbd>)
        )}
      </div>

      {open && term && !inSearchView && (
        <div className="absolute left-0 right-0 top-12 overflow-hidden rounded-xl border border-white/40 bg-white/90 p-1.5 shadow-2xl backdrop-blur-xl">
          {loading && results.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-ink-2">
              <Loader2 className="size-4 animate-spin" /> 검색 중…
            </div>
          ) : visible.length === 0 ? (
            <div className="px-3 py-3 text-sm text-ink-2">‘{term}’에 해당하는 할 일이 없습니다.</div>
          ) : (
            visible.map((t, i) => (
              <button
                key={t.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(t)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                  i === active && "bg-apple-blue/10",
                )}
              >
                <CalendarDays className="size-4 shrink-0 text-apple-blue" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <CategoryBadge category={t.category} />
                    <span className="truncate">{t.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ink-2">
                    {formatLong(t.date)}
                    {t.start_time && ` · ${shortTime(t.start_time)}`}
                    {t.repeat !== "none" && <Repeat className="size-3" />}
                  </div>
                </div>
                <div className="flex gap-1">
                  {t.tags.slice(0, 2).map((tag) => (
                    <TagChip key={tag} tag={tag} />
                  ))}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
