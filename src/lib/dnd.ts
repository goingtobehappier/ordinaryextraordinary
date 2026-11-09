import type { DragEvent } from "react";
import type { Todo } from "./types";

/** 할 일 드래그 데이터 (목록 → 타임라인 / 주간·월간 날짜 칸) */
export const TODO_DRAG_TYPE = "application/x-cockpit-todo";

export function startTodoDrag(e: DragEvent, todo: Todo) {
  e.dataTransfer.setData(TODO_DRAG_TYPE, todo.id);
  e.dataTransfer.setData("text/plain", todo.title);
  e.dataTransfer.effectAllowed = "move";
}

export function isTodoDrag(e: DragEvent) {
  return e.dataTransfer.types.includes(TODO_DRAG_TYPE);
}

export function readTodoDrag(e: DragEvent): string | null {
  return e.dataTransfer.getData(TODO_DRAG_TYPE) || null;
}
