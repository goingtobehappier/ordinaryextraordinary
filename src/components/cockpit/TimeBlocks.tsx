"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Utensils } from "lucide-react";
import { useCockpit } from "@/store/cockpit";
import { isDoneOn, minutesToTime, timeToMinutes, todayISO } from "@/lib/date";
import { isTodoDrag, readTodoDrag } from "@/lib/dnd";
import { CATEGORY_STYLE, type Todo } from "@/lib/types";
import { cn } from "@/lib/cn";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

const HOUR_PX = 52;
const DAY_START = 6 * 60; // 06:00
const DAY_END = 24 * 60; // 24:00
const SNAP = 15; // 분 단위 스냅
const DEFAULT_DURATION = 60; // 새로 배치 시 기본 1시간
const EDGE_PX = 7; // 위/아래 가장자리 리사이즈 영역

/** 매일 기본 표시되는 점심시간 */
export const LUNCH = { start: 11 * 60 + 30, end: 13 * 60, label: "점심시간" };

const minToPx = (m: number) => ((m - DAY_START) / 60) * HOUR_PX;
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** todo의 실제 시작/종료(분). 종료가 없으면 기본 1시간 */
function spanOf(t: Todo): { s: number; e: number } | null {
  const s = timeToMinutes(t.start_time);
  if (s === null) return null;
  const e = timeToMinutes(t.end_time);
  return { s, e: e !== null && e > s ? e : Math.min(s + DEFAULT_DURATION, DAY_END) };
}

type Block = { todo: Todo; s: number; e: number; col: number; cols: number };

function layoutBlocks(items: { todo: Todo; s: number; e: number }[]): Block[] {
  const timed = items
    .map((it) => ({ ...it, s: clamp(it.s, DAY_START, DAY_END - SNAP), e: clamp(it.e, DAY_START + SNAP, DAY_END) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);

  // 겹치는 일정끼리 묶어 가로로 나란히 배치
  const blocks: Block[] = [];
  let cluster: { todo: Todo; s: number; e: number; col: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => blocks.push({ ...c, cols }));
    cluster = [];
  };
  for (const item of timed) {
    if (item.s >= clusterEnd && cluster.length) flush();
    const colEnds: number[] = [];
    cluster.forEach((c) => (colEnds[c.col] = Math.max(colEnds[c.col] ?? 0, c.e)));
    let col = colEnds.findIndex((end) => end <= item.s);
    if (col === -1) col = colEnds.length;
    cluster.push({ ...item, col });
    clusterEnd = Math.max(clusterEnd, item.e);
  }
  if (cluster.length) flush();
  return blocks;
}

type DragState = {
  id: string;
  mode: "move" | "top" | "bottom";
  startY: number;
  startScroll: number;
  origS: number;
  origE: number;
  s: number;
  e: number;
  moved: boolean;
};

export function TimeBlocks({
  todos,
  date,
  onPickSlot,
}: {
  todos: Todo[];
  date: string;
  onPickSlot: (start: string) => void;
}) {
  const selectedTodoId = useCockpit((s) => s.selectedTodoId);
  const selectTodo = useCockpit((s) => s.selectTodo);
  const updateTodo = useCockpit((s) => s.updateTodo);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Todo | null>(null);
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const blocks = useMemo(() => {
    const items = todos.flatMap((t) => {
      if (drag && drag.id === t.id) return [{ todo: t, s: drag.s, e: drag.e }];
      const span = spanOf(t);
      return span ? [{ todo: t, ...span }] : [];
    });
    return layoutBlocks(items);
  }, [todos, drag]);

  const isToday = date === todayISO();
  const totalMinutes = blocks.reduce((sum, b) => sum + (b.e - b.s), 0);

  // 날짜가 바뀌면 첫 일정(또는 현재 시각) 근처로 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = blocks[0]?.s;
    const target = first ?? (isToday ? nowMin : 9 * 60);
    el.scrollTo({ top: Math.max(minToPx(target) - HOUR_PX, 0), behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  /** 화면 좌표 → 타임라인 분 */
  function minuteAt(clientY: number) {
    const rect = gridRef.current!.getBoundingClientRect();
    return DAY_START + ((clientY - rect.top) / HOUR_PX) * 60;
  }

  function commit(id: string, s: number, e: number) {
    void updateTodo(id, { start_time: minutesToTime(s), end_time: minutesToTime(e) });
  }

  // ── 목록에서 끌어다 놓기 (HTML5 DnD) ──
  function onDragOver(e: React.DragEvent) {
    if (!isTodoDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropAt(clamp(snap(minuteAt(e.clientY) - SNAP), DAY_START, DAY_END - DEFAULT_DURATION));
  }

  function onDrop(e: React.DragEvent) {
    const id = readTodoDrag(e);
    setDropAt(null);
    if (!id) return;
    e.preventDefault();
    const todo = useCockpit.getState().todos.find((t) => t.id === id);
    if (!todo) return;
    // 이미 시간이 있으면 길이 유지, 새로 배치하면 기본 1시간
    const span = spanOf(todo);
    const dur = span ? span.e - span.s : DEFAULT_DURATION;
    const s = clamp(snap(minuteAt(e.clientY) - SNAP), DAY_START, DAY_END - dur);
    commit(id, s, s + dur);
    selectTodo(id);
  }

  // ── 블록 이동/리사이즈 (Pointer Events) ──
  function onBlockPointerDown(e: React.PointerEvent<HTMLDivElement>, b: Block) {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const mode = y < EDGE_PX ? "top" : rect.height - y < EDGE_PX ? "bottom" : "move";
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      id: b.todo.id,
      mode,
      startY: e.clientY,
      startScroll: scrollRef.current?.scrollTop ?? 0,
      origS: b.s,
      origE: b.e,
      s: b.s,
      e: b.e,
      moved: false,
    });
  }

  function onBlockPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const scroller = scrollRef.current!;
    // 가장자리 근처에서 자동 스크롤
    const r = scroller.getBoundingClientRect();
    if (e.clientY < r.top + 36) scroller.scrollTop -= 12;
    else if (e.clientY > r.bottom - 36) scroller.scrollTop += 12;

    const dy = e.clientY - drag.startY + (scroller.scrollTop - drag.startScroll);
    const delta = snap((dy / HOUR_PX) * 60);
    const dur = drag.origE - drag.origS;
    let { s, e: end } = drag;
    if (drag.mode === "move") {
      s = clamp(drag.origS + delta, DAY_START, DAY_END - dur);
      end = s + dur;
    } else if (drag.mode === "top") {
      s = clamp(drag.origS + delta, DAY_START, drag.origE - SNAP);
    } else {
      end = clamp(drag.origE + delta, drag.origS + SNAP, DAY_END);
    }
    const moved = drag.moved || Math.abs(dy) > 3;
    if (s !== drag.s || end !== drag.e || moved !== drag.moved) setDrag({ ...drag, s, e: end, moved });
  }

  function onBlockPointerUp() {
    if (!drag) return;
    if (!drag.moved) {
      selectTodo(selectedTodoId === drag.id ? null : drag.id);
    } else if (drag.s !== drag.origS || drag.e !== drag.origE) {
      commit(drag.id, drag.s, drag.e);
    }
    setDrag(null);
  }

  function onBlockKeyDown(e: React.KeyboardEvent, b: Block) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Delete") {
      e.preventDefault();
      setPendingDelete(b.todo);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectTodo(selectedTodoId === b.todo.id ? null : b.todo.id);
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey) {
      // ↑/↓: 15분 이동, Shift+↑/↓: 길이 조절
      e.preventDefault();
      const d = e.key === "ArrowUp" ? -SNAP : SNAP;
      if (e.shiftKey) commit(b.todo.id, b.s, clamp(b.e + d, b.s + SNAP, DAY_END));
      else {
        const s = clamp(b.s + d, DAY_START, DAY_END - (b.e - b.s));
        commit(b.todo.id, s, s + (b.e - b.s));
      }
    }
  }

  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => DAY_START / 60 + i);

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3 text-xs text-ink-2 sm:px-5">
        <span className="min-w-0 truncate font-medium">
          타임블록<span className="hidden lg:inline"> · 목록에서 끌어다 놓기</span>
        </span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          배분 {Math.floor(totalMinutes / 60)}시간 {totalMinutes % 60}분
        </span>
      </div>
      <div
        ref={scrollRef}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
        }}
        onDrop={onDrop}
        className={cn("relative min-h-0 flex-1 overflow-y-auto px-3 pb-3 scroll-thin", drag && "select-none")}
      >
        <div ref={gridRef} className="relative" style={{ height: hours.length * HOUR_PX }}>
          {hours.map((h, i) => (
            <button
              key={h}
              type="button"
              onClick={() => onPickSlot(`${String(h).padStart(2, "0")}:00`)}
              data-deselect
              className="group absolute inset-x-0 flex items-start text-left"
              style={{ top: i * HOUR_PX, height: HOUR_PX }}
              title={`${h}:00에 할 일 추가`}
            >
              <span className="w-12 -translate-y-1.5 pr-2 text-right text-[11px] tabular-nums text-ink-2/80">
                {String(h).padStart(2, "0")}:00
              </span>
              <span className="h-full flex-1 border-t border-black/[0.06] transition-colors group-hover:bg-apple-blue/[0.04]" />
            </button>
          ))}

          <div className="pointer-events-none absolute bottom-0 left-12 right-1 top-0">
            {/* 점심시간 (매일 기본 블록) */}
            <div
              className="absolute inset-x-0 flex min-w-0 items-start gap-1.5 overflow-hidden whitespace-nowrap rounded-lg border border-dashed border-[#ff9500]/40 px-2.5 py-1.5 text-[11px] font-medium text-[#b86b00]"
              style={{
                top: minToPx(LUNCH.start),
                height: minToPx(LUNCH.end) - minToPx(LUNCH.start),
                backgroundImage:
                  "repeating-linear-gradient(135deg, rgb(255 149 0 / 0.08) 0 8px, rgb(255 149 0 / 0.03) 8px 16px)",
              }}
            >
              <Utensils className="mt-px size-3 shrink-0" />
              <span className="shrink-0">{LUNCH.label}</span>
              <span className="truncate tabular-nums opacity-70">
                {minutesToTime(LUNCH.start)}–{minutesToTime(LUNCH.end)}
              </span>
            </div>

            {/* 드롭 미리보기 */}
            {dropAt !== null && (
              <div
                className="absolute inset-x-0 z-20 rounded-lg border-2 border-dashed border-apple-blue/60 bg-apple-blue/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-apple-blue"
                style={{ top: minToPx(dropAt), height: (DEFAULT_DURATION / 60) * HOUR_PX }}
              >
                {minutesToTime(dropAt)}–{minutesToTime(dropAt + DEFAULT_DURATION)}
              </div>
            )}

            {blocks.map((b) => {
              const done = isDoneOn(b.todo, date);
              const selected = b.todo.id === selectedTodoId;
              const active = drag?.id === b.todo.id;
              const height = minToPx(b.e) - minToPx(b.s);
              return (
                <div
                  key={b.todo.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${b.todo.title} ${minutesToTime(b.s)}–${minutesToTime(b.e)} · 드래그로 이동, 가장자리로 길이 조절`}
                  onPointerDown={(e) => onBlockPointerDown(e, b)}
                  onPointerMove={onBlockPointerMove}
                  onPointerUp={onBlockPointerUp}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => onBlockKeyDown(e, b)}
                  className={cn(
                    "group pointer-events-auto absolute touch-none overflow-hidden rounded-lg border-l-[3px] px-2.5 py-1 text-left outline-none",
                    "transition-[box-shadow,background-color] duration-150 hover:shadow-md focus-visible:ring-2 focus-visible:ring-apple-blue/50",
                    active ? "z-30 cursor-grabbing shadow-lg" : "z-10 cursor-grab",
                    done ? "border-apple-mint bg-apple-mint/15 text-[#00857f]" : CATEGORY_STYLE[b.todo.category].block,
                    selected && "ring-2 ring-apple-blue/60 shadow-md",
                  )}
                  style={{
                    top: minToPx(b.s) + 1,
                    height: Math.max(height - 2, 20),
                    left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
                    width: `calc(${100 / b.cols}% - 4px)`,
                  }}
                >
                  {/* 리사이즈 핸들 */}
                  <span className="absolute inset-x-0 top-0 h-[7px] cursor-ns-resize" />
                  <span className="absolute inset-x-0 bottom-0 flex h-[7px] cursor-ns-resize justify-center">
                    <span className="mt-0.5 h-[3px] w-6 rounded-full bg-current opacity-0 transition-opacity group-hover:opacity-40" />
                  </span>

                  {/* 과업 삭제 (드래그 시작과 분리하기 위해 포인터 이벤트 전파 차단) */}
                  {!active && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(b.todo);
                      }}
                      aria-label={`${b.todo.title} 과업 삭제`}
                      title="과업 삭제 (Delete)"
                      className={cn(
                        "absolute right-1 top-1 z-10 flex size-5 cursor-pointer items-center justify-center rounded-md bg-white/80 text-ink-2 shadow-sm outline-none",
                        "opacity-0 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
                        "[@media(hover:none)]:opacity-100",
                        "hover:bg-[#ff3b30] hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#ff3b30]/50",
                        selected && "opacity-100",
                      )}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}

                  <div className={cn("truncate pr-5 text-xs font-semibold", done && "line-through")}>
                    <span className="mr-1 opacity-70">[{b.todo.category}]</span>
                    {b.todo.title}
                  </div>
                  {height > 34 && (
                    <div className="truncate text-[11px] tabular-nums opacity-80">
                      {minutesToTime(b.s)}–{minutesToTime(b.e)}
                      {active && ` · ${b.e - b.s}분`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isToday && nowMin >= DAY_START && (
            <div
              className="pointer-events-none absolute left-10 right-0 z-40 flex items-center"
              style={{ top: minToPx(nowMin) }}
            >
              <span className="size-2 -translate-x-1 rounded-full bg-[#ff3b30]" />
              <span className="h-px flex-1 bg-[#ff3b30]" />
            </div>
          )}
        </div>
      </div>
      <ConfirmDeleteDialog todo={pendingDelete} onClose={() => setPendingDelete(null)} />
    </div>
  );
}
