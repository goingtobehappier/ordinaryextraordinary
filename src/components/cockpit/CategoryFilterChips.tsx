"use client";

import { X } from "lucide-react";
import { useCategoryLabels, useCategoryStyle } from "@/store/categories";
import { cn } from "@/lib/cn";
import type { Category } from "@/lib/types";

/** 저장된 필터 중 현재 1차 태그 이름에 있는 것만 (다른 기기에서 이름이 바뀐 잔여 값 무시) */
export function useActiveCategoryFilter(stored: Category[]) {
  const labels = useCategoryLabels();
  return stored.filter((c) => labels.includes(c));
}

/**
 * 1차 태그 필터 칩 (월간·주간·일간·요약 공용).
 * 클릭 토글 · 다중 선택. 켜짐 = 채운 배경, 꺼짐 = 외곽선 + 흐린 색. 좁은 화면에서는 가로 스크롤.
 * 이름은 user_categories 설정을 실시간으로 따름.
 */
export function CategoryFilterChips({
  value,
  onToggle,
  onClear,
  className,
}: {
  value: Category[];
  onToggle: (c: Category) => void;
  onClear: () => void;
  className?: string;
}) {
  const labels = useCategoryLabels();
  const styleOf = useCategoryStyle();
  const active = value.filter((c) => labels.includes(c));

  return (
    <div
      role="group"
      aria-label="1차 태그 필터"
      className={cn("-mx-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto px-1 py-0.5 scrollbar-none", className)}
    >
      {labels.map((c) => {
        const on = active.includes(c);
        const st = styleOf(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(c)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-[background-color,color,opacity,border-color]",
              on
                ? cn(st.dot, "border-transparent text-white shadow-sm")
                : cn(st.text, "border-current/30 bg-transparent opacity-70 hover:opacity-100"),
            )}
          >
            {c}
          </button>
        );
      })}
      {active.length > 0 && (
        <button
          type="button"
          onClick={onClear}
          aria-label="태그 필터 해제"
          title="태그 필터 해제"
          className="flex shrink-0 items-center rounded-full p-1 text-ink-2 hover:bg-black/5 hover:text-ink"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
