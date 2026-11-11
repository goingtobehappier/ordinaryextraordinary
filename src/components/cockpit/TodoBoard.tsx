"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutList,
  GripVertical,
  Loader2,
  Plus,
  Repeat as RepeatIcon,
  Tags,
  Trash2,
} from "lucide-react";
import { DEFAULT_TAG, useCockpit } from "@/store/cockpit";
import {
  addDays,
  formatLong,
  isDoneOn,
  minutesToTime,
  occursOn,
  shortTime,
  timeToMinutes,
  todayISO,
  endTimeLabel,
} from "@/lib/date";
import { startTodoDrag } from "@/lib/dnd";
import {
  CATEGORIES,
  CATEGORY_STYLE,
  REPEAT_LABEL,
  DEFAULT_CATEGORY,
  type Category,
  type Repeat,
  type Todo,
} from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatCombo } from "@/hooks/useHotkeys";
import { useIsMobile } from "@/hooks/useIsMobile";
import { CategoryBadge, GlassButton, GlassInput, GlassPanel, Kbd, TagChip } from "@/components/ui/Glass";
import { CategoryPicker } from "./CategoryPicker";
import { TagChipInput, finalizeTags } from "./TagChipInput";
import { TimeBlocks } from "./TimeBlocks";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { ExternalEventStrip } from "./ExternalEvents";
import { AllDayBanner } from "./AllDayBanner";

export const NEW_TODO_INPUT_ID = "cockpit-new-todo";

/** 필터 바에 노출할 2차 태그 수 (최근 사용순) */
const RECENT_TAG_LIMIT = 5;

/** 태그 문자열 파싱. 비어 있으면 기본 태그(기타업무) */
export function parseTags(raw: string): string[] {
  const tags = Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean),
    ),
  );
  return tags.length ? tags : [DEFAULT_TAG];
}

export function TodoBoard() {
  const view = useCockpit((s) => s.view);
  const selectedDate = useCockpit((s) => s.selectedDate);
  const setSelectedDate = useCockpit((s) => s.setSelectedDate);
  const allTodos = useCockpit((s) => s.todos);
  const storedActiveTags = useCockpit((s) => s.activeTags);
  const recentTags = useCockpit((s) => s.recentTags);
  const storedActiveCategories = useCockpit((s) => s.activeCategories);
  const toggleTag = useCockpit((s) => s.toggleTag);
  const toggleCategory = useCockpit((s) => s.toggleCategory);
  const clearTags = useCockpit((s) => s.clearTags);
  const query = useCockpit((s) => s.searchQuery);
  const loading = useCockpit((s) => s.loading);

  const [prefillStart, setPrefillStart] = useState<{ start: string; nonce: number } | null>(null);
  const isMobile = useIsMobile();
  /** 모바일: 타임블록은 기본 접힘, '타임블록 보기'를 눌러야 불러와 표시 */
  const [blocksOpen, setBlocksOpen] = useState(false);
  const showBlocks = !isMobile || blocksOpen;

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

  // 2차 태그: 전체 할 일 기준 최근 사용순 상위 5개만 노출
  const visibleTags = useMemo(() => recentTags.slice(0, RECENT_TAG_LIMIT), [recentTags]);
  // 노출되지 않은 태그가 필터로 남아 목록을 숨기지 않도록, 보이는 태그만 필터에 적용
  // 모바일은 태그 필터 줄을 숨기므로, 해제할 수 없는 필터가 목록을 가리지 않도록 필터를 적용하지 않음
  const activeTags = isMobile ? [] : storedActiveTags.filter((t) => visibleTags.includes(t));
  const activeCategories = isMobile ? [] : storedActiveCategories;

  const q = query.trim().toLowerCase().replace(/^#/, "");
  const visible = dayTodos.filter(
    (t) =>
      (activeCategories.length === 0 || activeCategories.includes(t.category)) &&
      (activeTags.length === 0 || activeTags.some((tag) => t.tags.includes(tag))) &&
      (!q ||
        t.title.toLowerCase().includes(q) ||
        t.category.includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))),
  );

  const doneCount = dayTodos.filter((t) => isDoneOn(t, selectedDate)).length;
  const noFilter = activeTags.length === 0 && activeCategories.length === 0;

  return (
    // 데스크톱: 남은 높이를 채움 / 태블릿: 고정 높이 / 모바일: 목록·타임블록을 상하로 쌓아 더 높게
    // 모바일에서 타임블록이 접혀 있으면 목록만큼만 높이를 씀
    <GlassPanel
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden md:h-[720px] lg:h-auto lg:flex-1",
        showBlocks ? "h-[960px]" : "h-[560px]",
      )}
    >
      {/* 헤더 + 태그 필터 */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-y-2 border-b border-black/5 pb-3 pt-3.5 sm:pt-4 xl:flex-nowrap",
          // 모바일: 날짜 전체가 한 줄에 보이도록 좌우 여백·간격을 줄임
          isMobile ? "gap-x-2 px-3" : "gap-x-4 px-4 sm:px-6",
        )}
      >
        {view === "day" && (
          <div className="flex shrink-0">
            <GlassButton className="px-1.5" onClick={() => setSelectedDate(addDays(selectedDate, -1))} aria-label="이전 날">
              <ChevronLeft className="size-4" />
            </GlassButton>
            <GlassButton className="px-1.5" onClick={() => setSelectedDate(addDays(selectedDate, 1))} aria-label="다음 날">
              <ChevronRight className="size-4" />
            </GlassButton>
          </div>
        )}
        {/* 모바일: 날짜는 말줄임 없이 전체 표시 (줄어들지 않음, 공간이 부족하면 토글 버튼이 다음 줄로) */}
        <div className={cn(isMobile ? "shrink-0" : "min-w-0 flex-1 xl:flex-none")}>
          <h2
            className={cn(
              "font-semibold tracking-[-0.01em]",
              isMobile ? "whitespace-nowrap text-[16px]" : "truncate text-[17px] sm:text-[19px]",
            )}
          >
            {formatLong(selectedDate)}
            {selectedDate === todayISO() && (
              <span className={cn("font-medium text-apple-blue", isMobile ? "ml-1.5 text-xs" : "ml-2 text-sm")}>오늘</span>
            )}
          </h2>
          <p className="truncate text-xs text-ink-2">
            {dayTodos.length}개 중 {doneCount}개 완료
            {loading && <Loader2 className="ml-1.5 inline size-3 animate-spin" />}
          </p>
        </div>

        {/* 모바일 전용: 타임블록 보기/접기 */}
        {isMobile && (
          <button
            type="button"
            onClick={() => setBlocksOpen((o) => !o)}
            aria-pressed={blocksOpen}
            title={blocksOpen ? "타임블록 접기" : "타임블록 보기"}
            className={cn(
              "ml-auto flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
              // 켜짐: 브랜드 강조색 / 꺼짐: 회색
              blocksOpen
                ? "bg-apple-blue text-white shadow-sm shadow-apple-blue/30 active:bg-apple-blue/85"
                : "bg-black/[0.06] text-ink-2 active:bg-black/10",
            )}
          >
            <LayoutList className="size-3.5" />
            타임블록
          </button>
        )}

        {/* 태그 필터: 모바일(앱)에서는 줄 전체를 렌더링하지 않음 / 소형 화면: 아랫줄 전체 폭 + 가로 스크롤 / 데스크톱: 우측 정렬 */}
        {!isMobile && (
        <div className="flex w-full min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5 scroll-thin xl:ml-auto xl:w-auto xl:max-w-[66%]">
          <Tags className="size-4 shrink-0 text-ink-2" />
          <button
            onClick={clearTags}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors",
              noFilter ? "bg-ink text-white" : "bg-black/5 text-ink-2 hover:bg-black/10",
            )}
          >
            전체
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => toggleCategory(c)}
              className={cn(
                "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold transition-[box-shadow,opacity]",
                CATEGORY_STYLE[c].badge,
                activeCategories.includes(c) ? "ring-2 ring-current" : activeCategories.length && "opacity-50",
              )}
            >
              {c}
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px shrink-0 bg-black/10" />
          {visibleTags.map((tag) => (
            <button key={tag} onClick={() => toggleTag(tag)} className="shrink-0">
              <TagChip tag={tag} active={activeTags.includes(tag)} className="px-2.5 py-0.5 text-xs" />
            </button>
          ))}
        </div>
        )}
      </div>

      {/* 종일 일정(연차·휴가·여행): 날짜 바로 아래 고정 */}
      <AllDayBanner date={selectedDate} className={isMobile ? "px-3 sm:px-3" : undefined} />
      <AddTodoForm prefill={prefillStart} />
      <ExternalEventStrip date={selectedDate} />

      {/* 모바일: 목록(상) · 타임블록(하, 펼쳤을 때만 마운트) / 태블릿 이상: 좌우 */}
      <div
        className={cn(
          "grid min-h-0 flex-1 md:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] md:grid-rows-1",
          showBlocks ? "grid-rows-[minmax(0,1fr)_minmax(0,1.2fr)]" : "grid-rows-1",
        )}
      >
        <TodoList
          todos={visible}
          date={selectedDate}
          emptyFiltered={dayTodos.length > 0}
          className={showBlocks ? undefined : "border-b-0"}
        />
        {showBlocks && (
          <TimeBlocks
            todos={visible}
            occupied={dayTodos}
            date={selectedDate}
            onPickSlot={(start) => setPrefillStart({ start, nonce: Date.now() })}
          />
        )}
      </div>
    </GlassPanel>
  );
}

// ───────────────────────────── 추가 폼 ─────────────────────────────
/**
 * 키보드 동선: 할 일 → (Enter) 시작 → 종료 → 1차 태그 → 2차 태그 → (Enter) 추가
 *  - 시간 칸이 비어 있거나 두 번째 Enter → 시간 없이 1차 태그로
 *  - 1차 태그 Enter → 선택값(없으면 '업무') 확정 후 2차 태그로
 *  - 2차 태그 Enter → 제출 (비어 있으면 '기타업무')
 */
function AddTodoForm({ prefill }: { prefill: { start: string; nonce: number } | null }) {
  const selectedDate = useCockpit((s) => s.selectedDate);
  const addTodo = useCockpit((s) => s.addTodo);
  const combo = useCockpit((s) => s.shortcuts.newTodo);

  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [tagChips, setTagChips] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [saving, setSaving] = useState(false);
  const [timeError, setTimeError] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLButtonElement>(null);
  const tagsRef = useRef<HTMLInputElement>(null);

  // 타임라인 빈 칸 클릭 → 시작/종료(1시간)를 채우고 제목에 포커스
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (prefill && prefill.nonce !== appliedNonce) {
    setAppliedNonce(prefill.nonce);
    setStart(prefill.start);
    setEnd(minutesToTime(timeToMinutes(prefill.start)! + 60));
    setTimeError(false);
  }
  useEffect(() => {
    if (prefill) titleRef.current?.focus();
  }, [prefill]);

  // 한글 IME 조합 중 Enter는 무시
  const isEnter = (e: React.KeyboardEvent) => e.key === "Enter" && !e.nativeEvent.isComposing;

  function onTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") e.currentTarget.blur();
    if (!isEnter(e)) return;
    e.preventDefault();
    if (title.trim()) startRef.current?.focus();
  }

  function onStartKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isEnter(e)) return;
    e.preventDefault();
    if (!e.currentTarget.value) {
      // 시간 미입력 → 시간 없이 태그로
      setStart("");
      setEnd("");
      setTimeError(false);
      categoryRef.current?.focus();
    } else {
      endRef.current?.focus();
    }
  }

  function onEndKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isEnter(e)) return;
    e.preventDefault();
    categoryRef.current?.focus();
  }

  async function submit(finalTags?: string[]) {
    const t = title.trim();
    if (saving) return;
    if (!t) {
      titleRef.current?.focus();
      return;
    }
    if (start && end && end <= start) {
      setTimeError(true);
      startRef.current?.focus();
      return;
    }
    setSaving(true);
    const created = await addTodo({
      title: t,
      category: category ?? DEFAULT_CATEGORY,
      date: selectedDate,
      // 시간·반복은 선택 사항: 비우면 null / 반복 없음
      start_time: start || null,
      end_time: start ? end || null : null,
      tags: finalTags ?? finalizeTags(tagChips, tagDraft),
      repeat,
    });
    setSaving(false);
    if (created) {
      setTitle("");
      setStart("");
      setEnd("");
      setCategory(null);
      setTagChips([]);
      setTagDraft("");
      setRepeat("none");
      setTimeError(false);
      titleRef.current?.focus();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      // xl 미만: 제목 입력이 윗줄 전체, 시간·태그·반복·추가는 아랫줄에서 줄바꿈
      className="flex flex-wrap items-center gap-2 border-b border-black/5 px-4 py-3 sm:px-6 xl:flex-nowrap"
    >
      <div className="relative min-w-0 flex-1 basis-full xl:basis-auto">
        <Plus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-apple-blue" />
        <GlassInput
          id={NEW_TODO_INPUT_ID}
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onTitleKeyDown}
          placeholder="할 일 → Enter → 시간 → 1차 태그 → #2차 태그 → Enter"
          className="w-full truncate pl-9 pr-3 sm:pr-20"
          maxLength={300}
          autoComplete="off"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 gap-0.5 sm:flex">
          {formatCombo(combo).map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      </div>
      <div
        className={cn(
          "flex h-9 shrink-0 items-center gap-1 rounded-lg border border-black/5 bg-white/60 px-2 text-sm",
          timeError && "ring-2 ring-[#ff3b30]/50",
        )}
        title={timeError ? "종료 시간은 시작 시간 이후여야 합니다" : "시간 (선택)"}
      >
        <Clock className="size-3.5 text-ink-2" />
        <input
          ref={startRef}
          type="time"
          value={start}
          onKeyDown={onStartKeyDown}
          onChange={(e) => {
            setStart(e.target.value);
            setTimeError(false);
          }}
          className="bg-transparent tabular-nums outline-none"
          aria-label="시작 시간 (선택)"
        />
        <span className="text-ink-2">–</span>
        <input
          ref={endRef}
          type="time"
          value={end}
          onKeyDown={onEndKeyDown}
          onChange={(e) => {
            setEnd(e.target.value);
            setTimeError(false);
          }}
          className="bg-transparent tabular-nums outline-none"
          aria-label="종료 시간 (선택)"
        />
      </div>
      <CategoryPicker
        ref={categoryRef}
        value={category}
        onChange={setCategory}
        onDone={() => tagsRef.current?.focus()}
        className="w-[112px] shrink-0"
      />
      <TagChipInput
        ref={tagsRef}
        chips={tagChips}
        onChipsChange={setTagChips}
        draft={tagDraft}
        onDraftChange={setTagDraft}
        onSubmit={(tags) => void submit(tags)}
        className="min-w-[160px] flex-1 xl:w-56 xl:flex-none xl:shrink-0"
      />
      <select
        value={repeat}
        onChange={(e) => setRepeat(e.target.value as Repeat)}
        className="h-9 shrink-0 rounded-lg border border-black/5 bg-white/60 px-2 text-sm outline-none focus:ring-2 focus:ring-apple-blue/40"
        aria-label="반복 (선택)"
      >
        {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => (
          <option key={r} value={r}>
            {REPEAT_LABEL[r]}
          </option>
        ))}
      </select>
      <GlassButton type="submit" variant="primary" className="h-9 shrink-0 whitespace-nowrap px-4" disabled={!title.trim() || saving}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : "추가"}
      </GlassButton>
    </form>
  );
}

// ───────────────────────────── 목록 ─────────────────────────────
export function TodoList({
  todos,
  date,
  emptyFiltered,
  compact = false,
  emptyHint = "위 입력창에서 할 일을 추가해 보세요.",
  className,
}: {
  todos: Todo[];
  date: string;
  emptyFiltered: boolean;
  /** 좁은 영역(월간 보기 우측)용: 태그를 1개만 표시하고 테두리 제거 */
  compact?: boolean;
  emptyHint?: string;
  className?: string;
}) {
  const selectedTodoId = useCockpit((s) => s.selectedTodoId);
  const selectTodo = useCockpit((s) => s.selectTodo);
  const toggleDone = useCockpit((s) => s.toggleDone);
  const [pendingDelete, setPendingDelete] = useState<Todo | null>(null);

  if (todos.length === 0) {
    return (
      <div className={cn("flex min-w-0 flex-col items-center justify-center gap-1 break-keep px-4 py-6 text-center text-sm text-ink-2", !compact && "border-b border-black/5 md:border-b-0 md:border-r", className)}>
        <p className="font-medium text-ink">{emptyFiltered ? "필터에 맞는 할 일이 없어요" : "이 날은 비어 있어요"}</p>
        <p className="max-w-[320px]">{emptyFiltered ? "태그 필터나 검색어를 확인하세요." : emptyHint}</p>
      </div>
    );
  }

  return (
    <>
    <ul className={cn("min-h-0 min-w-0 space-y-1.5 overflow-y-auto px-2 py-3 sm:px-4 scroll-thin", compact ? "px-2 sm:px-3" : "border-b border-black/5 md:border-b-0 md:border-r", className)}>
      {todos.map((t) => {
        const done = isDoneOn(t, date);
        const selected = t.id === selectedTodoId;
        return (
          <li key={t.id}>
            <div
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(e) => startTodoDrag(e, t)}
              onClick={() => selectTodo(selected ? null : t.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectTodo(selected ? null : t.id);
                } else if (e.key === "Delete") {
                  // 포커스된 항목에서 Delete 키 → 삭제 확인
                  e.preventDefault();
                  setPendingDelete(t);
                }
              }}
              title={compact ? "달력의 다른 날짜로 끌어다 놓을 수 있어요" : "타임블록이나 다른 날짜로 끌어다 놓을 수 있어요"}
              className={cn(
                "group flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border py-2.5 pl-1 pr-2 outline-none sm:gap-2.5 sm:pl-1.5 sm:pr-3",
                "transition-[background-color,border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-apple-blue/40",
                selected
                  ? "border-apple-blue/30 bg-apple-blue/[0.07] shadow-sm"
                  : "border-transparent hover:bg-white/70",
              )}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-ink-2/30 group-hover:text-ink-2/70" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleDone(t, date);
                }}
                aria-label={done ? "완료 취소" : "완료"}
                className={cn(
                  "flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-150 active:scale-90",
                  done ? "border-apple-mint bg-apple-mint" : "border-black/20 hover:border-apple-mint",
                )}
              >
                <Check className={cn("size-3.5 text-white transition-opacity", done ? "opacity-100" : "opacity-0")} strokeWidth={3} />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <CategoryBadge category={t.category} />
                  <span title={t.title} className={cn("min-w-0 truncate text-[14px] font-medium transition-colors", done && "text-ink-2 line-through")}>
                    {t.title}
                  </span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-ink-2">
                  {t.start_time ? (
                    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium tabular-nums text-ink">
                      <Clock className="size-3 shrink-0" />
                      {shortTime(t.start_time)}
                      {t.end_time && `–${endTimeLabel(t.end_time)}`}
                    </span>
                  ) : (
                    <span className="min-w-0 truncate">
                      시간 미지정
                      {!compact && <span className="hidden xl:inline"> · 타임블록으로 끌어다 놓기</span>}
                    </span>
                  )}
                  {t.repeat !== "none" && (
                    <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md bg-apple-blue/10 px-1.5 py-px text-[10px] font-medium text-apple-blue">
                      <RepeatIcon className="size-2.5" />
                      {REPEAT_LABEL[t.repeat]}
                    </span>
                  )}
                </div>
              </div>

              {/* 태그: 모바일 숨김 · 좁은 폭에선 1개 · 넓은 화면에서 최대 3개 */}
              <div className="hidden max-w-[40%] shrink-0 gap-1 overflow-hidden sm:flex">
                {t.tags.slice(0, compact ? 1 : 3).map((tag, idx) => (
                  <TagChip key={tag} tag={tag} className={cn("max-w-[120px] truncate", idx > 0 && "hidden 2xl:inline-flex")} />
                ))}
              </div>
              <button
                type="button"
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete(t);
                }}
                aria-label={`${t.title} 과업 삭제`}
                title="과업 삭제 (Delete)"
                className={cn(
                  "-mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-2/60 outline-none",
                  "opacity-0 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
                  // 터치 기기(hover 없음)에서는 항상 노출
                  "[@media(hover:none)]:opacity-100",
                  "hover:bg-[#ff3b30]/10 hover:text-[#ff3b30] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#ff3b30]/40",
                  selected && "opacity-100",
                )}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
    <ConfirmDeleteDialog todo={pendingDelete} onClose={() => setPendingDelete(null)} />
    </>
  );
}
