"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
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
import { CategoryBadge, GlassButton, GlassInput, GlassPanel, Kbd, TagChip } from "@/components/ui/Glass";
import { CategoryPicker } from "./CategoryPicker";
import { TagChipInput, finalizeTags } from "./TagChipInput";
import { TimeBlocks } from "./TimeBlocks";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

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
  const activeCategories = useCockpit((s) => s.activeCategories);
  const toggleTag = useCockpit((s) => s.toggleTag);
  const toggleCategory = useCockpit((s) => s.toggleCategory);
  const clearTags = useCockpit((s) => s.clearTags);
  const query = useCockpit((s) => s.searchQuery);
  const loading = useCockpit((s) => s.loading);

  const [prefillStart, setPrefillStart] = useState<{ start: string; nonce: number } | null>(null);

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
  const activeTags = storedActiveTags.filter((t) => visibleTags.includes(t));

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
    <GlassPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 헤더 + 태그 필터 */}
      <div className="flex items-center gap-4 border-b border-black/5 px-6 pb-3 pt-4">
        {view === "day" && (
          <div className="flex">
            <GlassButton className="px-1.5" onClick={() => setSelectedDate(addDays(selectedDate, -1))} aria-label="이전 날">
              <ChevronLeft className="size-4" />
            </GlassButton>
            <GlassButton className="px-1.5" onClick={() => setSelectedDate(addDays(selectedDate, 1))} aria-label="다음 날">
              <ChevronRight className="size-4" />
            </GlassButton>
          </div>
        )}
        <div>
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">
            {formatLong(selectedDate)}
            {selectedDate === todayISO() && <span className="ml-2 text-sm font-medium text-apple-blue">오늘</span>}
          </h2>
          <p className="text-xs text-ink-2">
            {dayTodos.length}개 중 {doneCount}개 완료
            {loading && <Loader2 className="ml-1.5 inline size-3 animate-spin" />}
          </p>
        </div>

        <div className="ml-auto flex max-w-[66%] items-center gap-1.5 overflow-x-auto scroll-thin">
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
      </div>

      <AddTodoForm prefill={prefillStart} />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
        <TodoList todos={visible} date={selectedDate} emptyFiltered={dayTodos.length > 0} />
        <TimeBlocks
          todos={visible}
          date={selectedDate}
          onPickSlot={(start) => setPrefillStart({ start, nonce: Date.now() })}
        />
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
      className="flex items-center gap-2 border-b border-black/5 px-6 py-3"
    >
      <div className="relative min-w-0 flex-1">
        <Plus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-apple-blue" />
        <GlassInput
          id={NEW_TODO_INPUT_ID}
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onTitleKeyDown}
          placeholder="할 일 → Enter → 시간 → 1차 태그 → #2차 태그 → Enter"
          className="w-full pl-9 pr-20"
          maxLength={300}
          autoComplete="off"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 gap-0.5">
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
        className="w-56 shrink-0"
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
      <GlassButton type="submit" variant="primary" className="h-9 shrink-0 px-4" disabled={!title.trim() || saving}>
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
      <div className={cn("flex flex-col items-center justify-center gap-1 px-4 text-center text-sm text-ink-2", !compact && "border-r border-black/5", className)}>
        <p className="font-medium text-ink">{emptyFiltered ? "필터에 맞는 할 일이 없어요" : "이 날은 비어 있어요"}</p>
        <p>{emptyFiltered ? "태그 필터나 검색어를 확인하세요." : emptyHint}</p>
      </div>
    );
  }

  return (
    <>
    <ul className={cn("min-h-0 space-y-1.5 overflow-y-auto px-4 py-3 scroll-thin", compact ? "px-3" : "border-r border-black/5", className)}>
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
                "group flex cursor-pointer items-center gap-2.5 rounded-xl border py-2.5 pl-1.5 pr-3 outline-none",
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
                <div className="flex items-center gap-1.5">
                  <CategoryBadge category={t.category} />
                  <span className={cn("truncate text-[14px] font-medium transition-colors", done && "text-ink-2 line-through")}>
                    {t.title}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-2">
                  {t.start_time ? (
                    <span className="flex items-center gap-1 font-medium tabular-nums text-ink">
                      <Clock className="size-3" />
                      {shortTime(t.start_time)}
                      {t.end_time && `–${shortTime(t.end_time)}`}
                    </span>
                  ) : (
                    <span>{compact ? "시간 미지정" : "시간 미지정 · 타임블록으로 끌어다 놓기"}</span>
                  )}
                  {t.repeat !== "none" && (
                    <span className="flex items-center gap-0.5 rounded-md bg-apple-blue/10 px-1.5 py-px text-[10px] font-medium text-apple-blue">
                      <RepeatIcon className="size-2.5" />
                      {REPEAT_LABEL[t.repeat]}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 gap-1">
                {t.tags.slice(0, compact ? 1 : 3).map((tag) => (
                  <TagChip key={tag} tag={tag} />
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
