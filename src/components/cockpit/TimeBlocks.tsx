"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Trash2, Undo2, Utensils } from "lucide-react";
import { useCockpit } from "@/store/cockpit";
import { useLunch } from "@/store/lunch";
import { clockLabel, isDoneOn, minutesToTime, timeToMinutes, todayISO } from "@/lib/date";
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

export type LunchSlot = { s: number; e: number; shift: number; conflict: boolean };

/**
 * 점심시간 자동 밀림: 기본 위치에서 겹치는 업무 블록이 있으면 그 블록이 끝나는 시점으로 밀고,
 * 밀린 자리에서 또 겹치면 다시 밀기를 반복해 첫 빈 구간에 배치 (길이는 유지).
 * 하루 안에 빈 구간이 없으면 기본 위치에 두고 conflict 표시.
 * 저장된 할 일 시간만으로 계산되는 파생 값이라 DB·상태와 항상 일치함.
 */
export function placeLunch(spans: { s: number; e: number }[]): LunchSlot {
  const dur = LUNCH.end - LUNCH.start;
  const sorted = spans.filter((b) => b.e > b.s).sort((a, b) => a.s - b.s);
  let s = LUNCH.start;
  for (let moved = true; moved; ) {
    moved = false;
    for (const b of sorted) {
      if (b.s < s + dur && b.e > s) {
        s = b.e;
        moved = true;
      }
    }
    if (s + dur > DAY_END) return { s: LUNCH.start, e: LUNCH.end, shift: 0, conflict: true };
  }
  return { s, e: s + dur, shift: s - LUNCH.start, conflict: false };
}

const minToPx = (m: number) => ((m - DAY_START) / 60) * HOUR_PX;
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** todo의 실제 시작/종료(분). 종료가 없으면 기본 1시간 */
function spanOf(t: Todo): { s: number; e: number } | null {
  const s = timeToMinutes(t.start_time);
  if (s === null) return null;
  const raw = timeToMinutes(t.end_time);
  // 하루의 끝은 23:59로 저장되므로 24:00 구분선까지 채움
  const e = raw !== null && raw >= DAY_END - 1 ? DAY_END : raw;
  return { s, e: e !== null && e > s ? e : Math.min(s + DEFAULT_DURATION, DAY_END) };
}

/** 화면에 그려지는 범위로 맞춤. 블록 배치와 점심시간 충돌 계산이 같은 값을 쓰도록 공용 */
function clampSpan<T extends { s: number; e: number }>(it: T): T {
  return { ...it, s: clamp(it.s, DAY_START, DAY_END - SNAP), e: clamp(it.e, DAY_START + SNAP, DAY_END) };
}

type Block = { todo: Todo; s: number; e: number; col: number; cols: number };

function layoutBlocks(items: { todo: Todo; s: number; e: number }[]): Block[] {
  const timed = items.map(clampSpan).sort((a, b) => a.s - b.s || b.e - a.e);

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
  occupied = todos,
  date,
  onPickSlot,
}: {
  todos: Todo[];
  /** 점심시간 충돌 판단 기준 (필터와 무관한 그날의 전체 할 일) */
  occupied?: Todo[];
  date: string;
  onPickSlot: (start: string) => void;
}) {
  const selectedTodoId = useCockpit((s) => s.selectedTodoId);
  const selectTodo = useCockpit((s) => s.selectTodo);
  const updateTodo = useCockpit((s) => s.updateTodo);
  const setError = useCockpit((s) => s.setError);
  const lunchSkipped = useLunch((s) => !!s.skipped[date]);
  const skipLunch = useLunch((s) => s.skip);
  const restoreLunch = useLunch((s) => s.restore);

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

  // 드래그·드롭 미리보기 위치까지 반영해 점심시간이 실시간으로 밀리도록
  // 블록과 똑같이 clamp한 값으로 계산 → 그려진 블록과 점심시간이 픽셀 단위로도 겹치지 않음
  // 당일 점심시간을 삭제한 날은 블록도, 밀림 계산도 하지 않음 (해당 시간대는 빈 칸)
  const lunch = useMemo(() => {
    if (lunchSkipped) return null;
    // 화면에 그려지는 블록(todos)이 판단 기준(occupied)에서 빠지는 일이 없도록 합침
    const all = new Map([...occupied, ...todos].map((t) => [t.id, t]));
    const spans = [...all.values()].flatMap((t) => {
      if (drag && drag.id === t.id) return [clampSpan({ s: drag.s, e: drag.e })];
      const span = spanOf(t);
      return span ? [clampSpan(span)] : [];
    });
    if (dropAt !== null) spans.push(clampSpan({ s: dropAt, e: dropAt + DEFAULT_DURATION }));
    return placeLunch(spans);
  }, [lunchSkipped, occupied, todos, drag, dropAt]);

  async function toggleLunch(skip: boolean) {
    const err = await (skip ? skipLunch(date) : restoreLunch(date));
    if (err) setError(`점심시간을 ${skip ? "삭제" : "복원"}하지 못했습니다: ${err}`);
  }

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
        <span className="flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums">
          {lunchSkipped && (
            <button
              type="button"
              onClick={() => void toggleLunch(false)}
              className="flex items-center gap-1 rounded-md bg-[#ff9500]/10 px-1.5 py-0.5 font-medium text-[#b86b00] transition-colors hover:bg-[#ff9500]/20"
              title="이 날짜의 점심시간을 다시 표시"
            >
              <Undo2 className="size-3" />
              점심 복원
            </button>
          )}
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
        // 상하 여백: 라벨이 구분선 중앙에 걸치므로(위아래로 반 줄씩 튀어나옴) 06:00·24:00 라벨이 잘리지 않게 확보
        className={cn("relative min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3 scroll-thin", drag && "select-none")}
      >
        <div ref={gridRef} className="relative" style={{ height: hours.length * HOUR_PX }}>
          {hours.map((h, i) => (
            <button
              key={h}
              type="button"
              onClick={() => onPickSlot(clockLabel(h * 60))}
              data-deselect
              className="group absolute inset-x-0 block text-left"
              style={{ top: i * HOUR_PX, height: HOUR_PX }}
              title={`${clockLabel(h * 60)}에 할 일 추가`}
            >
              <HourLabel minutes={h * 60} />
              <span className="absolute inset-y-0 left-12 right-0 border-t border-black/[0.06] transition-colors group-hover:bg-apple-blue/[0.04]" />
            </button>
          ))}
          {/* 마지막 경계: 24:00 구분선 + 라벨 */}
          <div className="pointer-events-none absolute inset-x-0" style={{ top: hours.length * HOUR_PX }} aria-hidden>
            <HourLabel minutes={DAY_END} />
            <span className="absolute left-12 right-0 top-0 border-t border-black/[0.06]" />
          </div>

          <div className="pointer-events-none absolute bottom-0 left-12 right-1 top-0">
            {/* 점심시간 (매일 기본 블록) — 업무 블록과 겹치면 자동으로 뒤로 밀림. 당일 삭제한 날은 그리지 않음 */}
            {lunch && (
            <div
              className={cn(
                // z-0: 업무 블록(z-10) 아래. 빈 구간이 없어 겹칠 수밖에 없을 때도 업무 블록 텍스트가 가려지지 않음
                // pointer-events-auto: 호버 시 삭제 버튼·툴팁 표시 (상위 레이어는 pointer-events-none)
                "group/lunch pointer-events-auto absolute inset-x-0 z-0 flex min-w-0 items-start gap-1.5 overflow-hidden whitespace-nowrap rounded-lg border border-dashed py-1.5 pl-2.5 pr-7 text-[11px] font-medium",
                "transition-[top,height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
                lunch.conflict ? "border-[#ff3b30]/40 text-[#c4271d] opacity-60" : "border-[#ff9500]/40 text-[#b86b00]",
              )}
              style={{
                // 업무 블록과 같은 기준(top + 1px, height - 2px)으로 배치 → 맞닿아도 2px 간격으로 분리
                top: minToPx(lunch.s) + 1,
                height: minToPx(lunch.e) - minToPx(lunch.s) - 2,
                backgroundImage: lunch.conflict
                  ? "repeating-linear-gradient(135deg, rgb(255 59 48 / 0.08) 0 8px, rgb(255 59 48 / 0.03) 8px 16px)"
                  : "repeating-linear-gradient(135deg, rgb(255 149 0 / 0.08) 0 8px, rgb(255 149 0 / 0.03) 8px 16px)",
              }}
              title={
                lunch.conflict
                  ? "남은 시간에 점심시간을 둘 빈 구간이 없습니다"
                  : lunch.shift > 0
                    ? `업무 일정과 겹쳐 ${formatShift(lunch.shift)} 뒤로 밀렸습니다 (기본 ${clockLabel(LUNCH.start)}–${clockLabel(LUNCH.end)})`
                    : undefined
              }
            >
              {/* 빈 구간이 없으면 업무 블록 아래 깔리므로 텍스트 없이 빗금만 (사유는 툴팁) */}
              {!lunch.conflict && (
                <>
                  <Utensils className="mt-px size-3 shrink-0" />
                  <span className="shrink-0">{LUNCH.label}</span>
                  <span className="shrink-0 tabular-nums opacity-70">
                    {clockLabel(lunch.s)}–{clockLabel(lunch.e)}
                  </span>
                  {lunch.shift > 0 && (
                    <span className="flex min-w-0 items-center gap-0.5 truncate rounded bg-[#ff9500]/15 px-1 tabular-nums">
                      <ArrowDown className="size-2.5 shrink-0" />
                      {formatShift(lunch.shift)}
                    </span>
                  )}
                </>
              )}
              {/* 당일 점심시간 삭제 (기본 설정은 유지) */}
              <button
                type="button"
                onClick={() => void toggleLunch(true)}
                aria-label="오늘 점심시간 삭제"
                title="이 날짜의 점심시간만 삭제 (다른 날은 그대로)"
                className={cn(
                  "pointer-events-auto absolute right-1 top-1 flex size-5 cursor-pointer items-center justify-center rounded-md bg-white/80 text-ink-2 shadow-sm outline-none",
                  "opacity-0 transition-[opacity,background-color,color] duration-150 group-hover/lunch:opacity-100 [@media(hover:none)]:opacity-100",
                  "hover:bg-[#ff3b30] hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#ff3b30]/50",
                )}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
            )}

            {/* 드롭 미리보기 */}
            {dropAt !== null && (
              <div
                className="absolute inset-x-0 z-20 rounded-lg border-2 border-dashed border-apple-blue/60 bg-apple-blue/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-apple-blue"
                style={{ top: minToPx(dropAt), height: (DEFAULT_DURATION / 60) * HOUR_PX }}
              >
                {clockLabel(dropAt)}–{clockLabel(dropAt + DEFAULT_DURATION)}
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
                  aria-label={`${b.todo.title} ${clockLabel(b.s)}–${clockLabel(b.e)} · 드래그로 이동, 가장자리로 길이 조절`}
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
                      {clockLabel(b.s)}–{clockLabel(b.e)}
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

/** 90 → "1시간 30분", 45 → "45분" */
function formatShift(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h && `${h}시간`, m && `${m}분`].filter(Boolean).join(" ");
}

/** 시간 라벨: 부모 상단(= 해당 시각 구분선)에 텍스트 수직 중앙을 맞춤 */
function HourLabel({ minutes }: { minutes: number }) {
  return (
    <span className="absolute left-0 top-0 w-12 -translate-y-1/2 pr-2 text-right text-[11px] leading-none tabular-nums text-ink-2/80">
      {clockLabel(minutes)}
    </span>
  );
}
