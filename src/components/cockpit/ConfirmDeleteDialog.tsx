"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { useCockpit } from "@/store/cockpit";
import { shortTime } from "@/lib/date";
import { REPEAT_LABEL, type Todo } from "@/lib/types";
import { CategoryBadge, GlassButton } from "@/components/ui/Glass";

/**
 * 과업 삭제 확인 다이얼로그
 * - 확인 시 Supabase `todos`에서 DELETE (스토어 deleteTodo: 낙관적 제거, 실패 시 복구 + 오류 표시)
 * - 기본 포커스는 '취소' (실수 방지), Esc / 바깥 클릭으로 닫힘, 닫히면 원래 포커스로 복귀
 * - body로 포털하되, React 이벤트가 부모(드래그 가능한 목록·타임블록)로 전파되지 않도록 차단
 */
export function ConfirmDeleteDialog({ todo, onClose }: { todo: Todo | null; onClose: () => void }) {
  const deleteTodo = useCockpit((s) => s.deleteTodo);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!todo) return;
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      if (prev?.isConnected) prev.focus();
    };
  }, [todo]);

  if (!todo) return null;

  const isRepeat = todo.repeat !== "none";

  function confirm() {
    if (!todo) return;
    onClose();
    void deleteTodo(todo.id);
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      data-keep-selection
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm print:hidden"
      onPointerDown={stop}
      onClick={stop}
      onDragStart={stop}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-desc"
        className="w-[380px] max-w-[calc(100vw-32px)] rounded-2xl border border-white/40 bg-white/85 p-5 shadow-2xl backdrop-blur-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#ff3b30]/10">
            <Trash2 className="size-[18px] text-[#ff3b30]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-delete-title" className="text-[15px] font-semibold text-ink">
              과업을 삭제할까요?
            </h2>
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-black/[0.04] px-2.5 py-2">
              <CategoryBadge category={todo.category} />
              <span className="truncate text-sm font-medium text-ink">{todo.title}</span>
              {todo.start_time && (
                <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-2">
                  {shortTime(todo.start_time)}
                  {todo.end_time && `–${shortTime(todo.end_time)}`}
                </span>
              )}
            </div>
            <p id="confirm-delete-desc" className="mt-2 text-xs leading-relaxed text-ink-2">
              {isRepeat ? (
                <>
                  <b className="font-semibold text-[#ff3b30]">{REPEAT_LABEL[todo.repeat]} 반복 일정 전체</b>가 삭제됩니다.{" "}
                </>
              ) : null}
              메모·하위 작업을 포함해 삭제되며 되돌릴 수 없어요.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <GlassButton ref={cancelRef} onClick={onClose} className="bg-black/5">
            취소
          </GlassButton>
          <GlassButton
            onClick={confirm}
            className="bg-[#ff3b30] text-white shadow-sm shadow-[#ff3b30]/30 hover:bg-[#e0352b] hover:text-white"
          >
            삭제
          </GlassButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
