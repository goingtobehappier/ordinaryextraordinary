"use client";

import { useEffect, useRef } from "react";
import { useCockpit } from "@/store/cockpit";
import { DetailBody } from "./TaskDetailPanel";

/**
 * 수정 전용 모달 (검색·요약 뷰). 하단 상세 패널과 같은 편집 UI를 사용하며,
 * 메모·하위 작업·속성 변경은 즉시 저장됩니다. 바깥 클릭 / Esc / 닫기 버튼으로 닫힘.
 */
export function TaskEditModal() {
  const selectedTodoId = useCockpit((s) => s.selectedTodoId);
  const todo = useCockpit((s) => s.todos.find((t) => t.id === s.selectedTodoId));
  const selectTodo = useCockpit((s) => s.selectTodo);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 열릴 때 모달로 포커스 이동, 닫히면 원래 위치로 복귀
  useEffect(() => {
    if (!selectedTodoId) return;
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => prev?.focus?.();
  }, [selectedTodoId]);

  if (!todo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm print:hidden"
      onMouseDown={(e) => e.target === e.currentTarget && selectTodo(null)}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`${todo.title} 수정`} tabIndex={-1} className="outline-none">
        <DetailBody key={todo.id} todo={todo} variant="modal" />
      </div>
    </div>
  );
}
