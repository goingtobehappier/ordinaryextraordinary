"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Clock, Loader2, Plus, Repeat as RepeatIcon, RotateCw, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { loadTodoDetail, saveTodoDetail, type Detail } from "@/lib/todoDetails";
import { useCockpit } from "@/store/cockpit";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { formatLong, isDoneOn, shortTime } from "@/lib/date";
import { CATEGORIES, CATEGORY_STYLE, REPEAT_LABEL, type Category, type Repeat, type Subtask, type Todo } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatCombo } from "@/hooks/useHotkeys";
import { GlassButton, GlassInput, GlassPanel, Kbd } from "@/components/ui/Glass";
import { parseTags } from "./TodoBoard";

export function TaskDetailPanel() {
  const selectedTodoId = useCockpit((s) => s.selectedTodoId);
  // 닫히는 애니메이션 동안 마지막 내용을 유지
  const [shownId, setShownId] = useState(selectedTodoId);
  if (selectedTodoId && selectedTodoId !== shownId) setShownId(selectedTodoId);

  const todo = useCockpit((s) => s.todos.find((t) => t.id === shownId));
  if (!todo) return <div className="h-[300px]" />;
  return <DetailBody key={todo.id} todo={todo} />;
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** 상세 편집 본문. panel = 하단 슬라이드 패널, modal = 검색·요약 뷰의 수정 모달 */
export function DetailBody({ todo, variant = "panel" }: { todo: Todo; variant?: "panel" | "modal" }) {
  const bumpRev = useCockpit((s) => s.bumpRev);
  const userId = useCockpit((s) => s.userId);
  const selectedDate = useCockpit((s) => s.selectedDate);
  const selectTodo = useCockpit((s) => s.selectTodo);
  const updateTodo = useCockpit((s) => s.updateTodo);
  const deleteTodo = useCockpit((s) => s.deleteTodo);
  const toggleDone = useCockpit((s) => s.toggleDone);
  const closeCombo = useCockpit((s) => s.shortcuts.closeDetail);

  const setError = useCockpit((s) => s.setError);

  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [memo, setMemo] = useState("");
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSub, setNewSub] = useState("");
  const [save, setSave] = useState<SaveState>("idle");
  const [title, setTitle] = useState(todo.title);
  const [tagsRaw, setTagsRaw] = useState(todo.tags.join(", "));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const loaded = loadState === "ready";

  /** 서버에 저장이 확인된 마지막 상태 (실패 시 하위 작업 롤백 기준) */
  const confirmed = useRef<Detail>({ memo: "", subtasks: [] });
  /** 저장 직렬화: 진행 중인 요청이 있으면 최신 값만 대기열에 두고 끝난 뒤 이어서 저장 */
  const inflight = useRef(false);
  const queued = useRef<Detail | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadTodoDetail(createClient(), todo.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        // 불러오지 못한 상태로 편집하면 기존 하위 작업을 빈 목록으로 덮어쓰므로 편집을 막음
        setLoadState("error");
        setError(`상세를 불러오지 못했습니다: ${res.message}`);
        return;
      }
      confirmed.current = res.data;
      setMemo(res.data.memo);
      setSubtasks(res.data.subtasks);
      setLoadState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [todo.id, reloadKey, setError]);

  async function persist(next: Detail) {
    if (inflight.current) {
      queued.current = next;
      return;
    }
    inflight.current = true;
    setSave("saving");
    let current: Detail | null = next;
    while (current) {
      queued.current = null;
      const res = await saveTodoDetail(createClient(), todo.id, current, userId);
      if (!res.ok) {
        // 하위 작업은 서버 기준으로 롤백, 메모는 입력 중인 내용을 지키고 재시도 버튼 제공
        queued.current = null;
        setSubtasks(confirmed.current.subtasks);
        setSave("error");
        setError(`하위 작업·메모 저장 실패: ${res.message}`);
        inflight.current = false;
        return;
      }
      confirmed.current = current;
      current = queued.current;
    }
    inflight.current = false;
    setSave("saved");
    bumpRev();
  }

  const memoSaver = useDebouncedCallback((m: string, subs: Subtask[]) => void persist({ memo: m, subtasks: subs }), 600);

  // 낙관적 업데이트: 화면에 먼저 반영하고 즉시 저장 (실패 시 persist에서 롤백)
  function updateSubtasks(next: Subtask[]) {
    if (!loaded) return;
    setSubtasks(next);
    memoSaver.call(memo, next);
    memoSaver.flush();
  }

  function retrySave() {
    setError(null);
    memoSaver.call(memo, subtasks);
    memoSaver.flush();
  }

  function addSubtask() {
    const text = newSub.trim();
    if (!text) return;
    updateSubtasks([...subtasks, { id: crypto.randomUUID(), text, done: false }]);
    setNewSub("");
  }

  function commitTitle() {
    const t = title.trim();
    if (!t) setTitle(todo.title);
    else if (t !== todo.title) void updateTodo(todo.id, { title: t });
  }

  function commitTags() {
    const tags = parseTags(tagsRaw);
    setTagsRaw(tags.join(", "));
    if (tags.join() !== todo.tags.join()) void updateTodo(todo.id, { tags });
  }

  function commitTime(field: "start_time" | "end_time", input: HTMLInputElement) {
    const v = input.value || null;
    if (shortTime(v) === shortTime(todo[field])) return;
    const other = field === "start_time" ? todo.end_time : todo.start_time;
    const [s, e] = field === "start_time" ? [v, other] : [other, v];
    if (s && e && shortTime(e) <= shortTime(s)) {
      // 잘못된 범위는 되돌림 (DB 제약 위반 방지)
      input.value = shortTime(todo[field]);
      return;
    }
    void updateTodo(todo.id, { [field]: v });
  }

  const done = isDoneOn(todo, selectedDate);
  const subDone = subtasks.filter((s) => s.done).length;

  return (
    <GlassPanel
      className={cn(
        "flex flex-col overflow-hidden",
        // 모바일: 메모·하위 작업을 상하로 쌓으므로 더 높게
        variant === "modal"
          ? "h-[min(640px,88dvh)] w-[min(960px,calc(100vw-24px))] bg-white/90 shadow-2xl md:h-[min(520px,80vh)]"
          : "h-[560px] md:h-[300px]",
      )}
    >
      {/* 상단 바 */}
      <div className="flex min-w-0 items-center gap-2 border-b border-black/5 px-4 py-3 sm:gap-3 sm:px-6">
        <button
          onClick={() => void toggleDone(todo, selectedDate)}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
            done ? "border-apple-mint bg-apple-mint" : "border-black/20 hover:border-apple-mint",
          )}
          aria-label={done ? "완료 취소" : "완료"}
        >
          <Check className={cn("size-4 text-white", !done && "opacity-0")} strokeWidth={3} />
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={cn(
            "min-w-0 flex-1 rounded-lg bg-transparent px-1 text-[17px] font-semibold outline-none focus:bg-white/70",
            done && "text-ink-2 line-through",
          )}
          maxLength={300}
          aria-label="제목"
        />
        {loadState === "error" ? (
          <SaveIndicator
            state="error"
            label="불러오기 실패"
            onRetry={() => {
              setError(null);
              setLoadState("loading");
              setReloadKey((k) => k + 1);
            }}
          />
        ) : (
          <SaveIndicator state={save} onRetry={retrySave} />
        )}
        {confirmDelete ? (
          <div className="flex shrink-0 items-center gap-1">
            <span className="hidden whitespace-nowrap text-xs text-ink-2 sm:inline">
              {todo.repeat !== "none" ? "반복 일정 전체를 삭제할까요?" : "삭제할까요?"}
            </span>
            <GlassButton variant="danger" onClick={() => void deleteTodo(todo.id)}>
              삭제
            </GlassButton>
            <GlassButton onClick={() => setConfirmDelete(false)}>취소</GlassButton>
          </div>
        ) : (
          <GlassButton variant="danger" className="px-2" onClick={() => setConfirmDelete(true)} aria-label="삭제">
            <Trash2 className="size-4" />
          </GlassButton>
        )}
        <GlassButton onClick={() => selectTodo(null)} className="shrink-0 gap-1 px-2" title="닫기" aria-label="닫기">
          <ChevronDown className="size-4 shrink-0" />
          <span className="hidden gap-1 sm:flex">
            {formatCombo(closeCombo).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        </GlassButton>
      </div>

      {/* 모바일: 메모(상) · 하위 작업(하) / 태블릿 이상: 좌우 */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1.2fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:grid-rows-1">
        {/* 메모 + 속성 */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3 border-b border-black/5 px-4 py-4 sm:px-6 md:border-b-0 md:border-r">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <select
              value={todo.category}
              onChange={(e) => void updateTodo(todo.id, { category: e.target.value as Category })}
              className={cn("rounded-md px-1.5 py-1 text-xs font-semibold outline-none", CATEGORY_STYLE[todo.category].badge)}
              aria-label="1차 태그"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="whitespace-nowrap rounded-md bg-black/5 px-2 py-1">{formatLong(todo.date)} 시작</span>
            <label className="flex items-center gap-1 rounded-md bg-black/5 px-2 py-0.5">
              <Clock className="size-3" />
              <input
                type="time"
                defaultValue={shortTime(todo.start_time)}
                onBlur={(e) => commitTime("start_time", e.currentTarget)}
                className="bg-transparent tabular-nums outline-none"
                aria-label="시작 시간"
              />
              –
              <input
                type="time"
                defaultValue={shortTime(todo.end_time)}
                onBlur={(e) => commitTime("end_time", e.currentTarget)}
                className="bg-transparent tabular-nums outline-none"
                aria-label="종료 시간"
              />
            </label>
            <label className="flex items-center gap-1 rounded-md bg-black/5 px-2 py-0.5">
              <RepeatIcon className="size-3" />
              <select
                value={todo.repeat}
                onChange={(e) => void updateTodo(todo.id, { repeat: e.target.value as Repeat })}
                className="bg-transparent outline-none"
                aria-label="반복"
              >
                {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => (
                  <option key={r} value={r}>
                    {REPEAT_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <GlassInput
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              onBlur={commitTags}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              placeholder="#2차 태그"
              className="h-7 w-full min-w-0 rounded-md text-xs sm:w-44"
              aria-label="2차 태그"
            />
          </div>

          <textarea
            value={memo}
            onChange={(e) => {
              setMemo(e.target.value);
              memoSaver.call(e.target.value, subtasks);
            }}
            onBlur={memoSaver.flush}
            disabled={!loaded}
            placeholder={
              loaded ? "세부 메모를 작성하세요…" : loadState === "error" ? "불러오지 못했습니다. 상단의 다시 시도를 눌러 주세요." : "불러오는 중…"
            }
            className="min-h-0 flex-1 resize-none rounded-xl border border-black/5 bg-white/50 p-3 text-sm leading-relaxed outline-none transition-[background-color,box-shadow] focus:bg-white/80 focus:ring-2 focus:ring-apple-blue/30 scroll-thin"
          />
        </div>

        {/* 하위 작업 */}
        <div className="flex min-h-0 min-w-0 flex-col px-4 py-4 sm:px-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">하위 작업</span>
            <span className="text-xs tabular-nums text-ink-2">
              {subDone}/{subtasks.length}
            </span>
          </div>
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-black/5">
            <div
              className="h-full rounded-full bg-apple-mint transition-[width] duration-300"
              style={{ width: subtasks.length ? `${(subDone / subtasks.length) * 100}%` : 0 }}
            />
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto scroll-thin">
            {subtasks.map((s) => (
              <li key={s.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-black/[0.03]">
                <button
                  onClick={() => updateSubtasks(subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))}
                  className={cn(
                    "flex size-[18px] shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors",
                    s.done ? "border-apple-blue bg-apple-blue" : "border-black/20 hover:border-apple-blue",
                  )}
                  aria-label={s.done ? "완료 취소" : "완료"}
                >
                  <Check className={cn("size-3 text-white", !s.done && "opacity-0")} strokeWidth={3} />
                </button>
                <span className={cn("flex-1 truncate text-sm", s.done && "text-ink-2 line-through")}>{s.text}</span>
                <button
                  onClick={() => updateSubtasks(subtasks.filter((x) => x.id !== s.id))}
                  className="rounded p-0.5 text-ink-2 opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100"
                  aria-label="하위 작업 삭제"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addSubtask();
            }}
            className="mt-2 flex gap-1.5"
          >
            <GlassInput
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              placeholder="하위 작업 추가"
              className="h-8 flex-1"
              disabled={!loaded}
            />
            <GlassButton type="submit" variant="mint" className="h-8 px-2" disabled={!newSub.trim()} aria-label="추가">
              <Plus className="size-4" />
            </GlassButton>
          </form>
        </div>
      </div>
    </GlassPanel>
  );
}

function SaveIndicator({ state, label, onRetry }: { state: SaveState; label?: string; onRetry?: () => void }) {
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <button
        onClick={onRetry}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs text-[#c4271d] hover:bg-[#c4271d]/10"
        title="다시 시도 (자세한 원인은 개발자 도구 콘솔 참고)"
      >
        <RotateCw className="size-3" />
        {label ?? "저장 실패"} · 다시 시도
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-ink-2">
      {state === "saving" && <Loader2 className="size-3 animate-spin" />}
      {state === "saving" ? "저장 중" : "저장됨"}
    </span>
  );
}
