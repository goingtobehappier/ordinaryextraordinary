"use client";

import { forwardRef, useId, useState } from "react";
import { Hash, X } from "lucide-react";
import { DEFAULT_TAG, useCockpit } from "@/store/cockpit";
import { cn } from "@/lib/cn";

const cleanTag = (t: string) => t.replace(/^#+/, "").trim();

/** 작성 중인 토큰 + 확정된 칩 → 최종 2차 태그 (비어 있으면 기타업무) */
export function finalizeTags(chips: string[], draft: string): string[] {
  const all = Array.from(new Set([...chips, cleanTag(draft)].filter(Boolean)));
  return all.length ? all : [DEFAULT_TAG];
}

type Props = {
  chips: string[];
  onChipsChange: (chips: string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  /** 추천 항목을 고르지 않은 상태에서 Enter → 최종 태그와 함께 폼 제출 */
  onSubmit: (tags: string[]) => void;
  className?: string;
};

/**
 * 2차 태그 (선택, 복수).
 * - '#단어' 입력 후 Space(또는 쉼표) → 태그칩으로 변환, 다음 입력용 '#' 자동 입력
 * - ↑/↓로 기존 태그 추천 선택, Enter/Tab으로 적용
 * - Enter → 폼 제출 (아무것도 없으면 '기타업무')
 * - 빈 상태에서 Backspace → 마지막 칩 삭제
 */
export const TagChipInput = forwardRef<HTMLInputElement, Props>(function TagChipInput(
  { chips, onChipsChange, draft, onDraftChange, onSubmit, className },
  ref,
) {
  const allTags = useCockpit((s) => s.allTags);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  const token = cleanTag(draft);
  const q = token.toLowerCase();
  const suggestions = allTags.filter((t) => !chips.includes(t) && t.toLowerCase().includes(q)).slice(0, 8);
  const showing = open && suggestions.length > 0;

  function addChips(tags: string[]) {
    const next = Array.from(new Set([...chips, ...tags.map(cleanTag).filter(Boolean)]));
    if (next.length !== chips.length) onChipsChange(next);
  }

  function handleChange(value: string) {
    setActive(-1);
    setOpen(true);
    // 공백/쉼표가 들어오면 그 앞까지를 칩으로 확정 (한글 IME에서도 동작하도록 onChange에서 처리)
    if (/[\s,]/.test(value)) {
      const parts = value.split(/[\s,]+/);
      const rest = parts.pop() ?? "";
      addChips(parts);
      onDraftChange(`#${cleanTag(rest)}`);
      return;
    }
    onDraftChange(value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return; // 한글 조합 중 키 무시
    if (e.key === "ArrowDown" && showing) {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && showing) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if ((e.key === "Enter" || e.key === "Tab") && showing && active >= 0) {
      e.preventDefault();
      addChips([suggestions[active]]);
      onDraftChange("#");
      setActive(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const tags = finalizeTags(chips, draft);
      onChipsChange(tags);
      onDraftChange("#");
      setOpen(false);
      onSubmit(tags);
    } else if (e.key === "Backspace" && (draft === "" || draft === "#") && chips.length) {
      e.preventDefault();
      onChipsChange(chips.slice(0, -1));
    } else if (e.key === "Escape") {
      if (showing) {
        e.stopPropagation(); // 드롭다운만 닫고 선택 해제(ESC)는 막음
        setOpen(false);
      }
      else e.currentTarget.blur();
    }
  }

  return (
    <div className={cn("relative", className)}>
      <div className="flex h-9 items-center gap-1 overflow-x-auto rounded-lg border border-black/5 bg-white/60 pl-2 pr-1.5 transition-[box-shadow,background-color] scroll-thin focus-within:bg-white/90 focus-within:ring-2 focus-within:ring-apple-blue/40">
        <Hash className="size-3.5 shrink-0 text-ink-2" />
        {chips.map((c) => (
          <span
            key={c}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-apple-mint/15 py-0.5 pl-1.5 pr-0.5 text-xs font-medium text-[#00857f]"
          >
            #{c}
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChipsChange(chips.filter((x) => x !== c))}
              className="rounded p-px hover:bg-black/10"
              aria-label={`${c} 태그 삭제`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={ref}
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => {
            if (!draft) onDraftChange("#");
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
            if (token) {
              addChips([token]);
              onDraftChange("");
            } else if (draft === "#") onDraftChange("");
          }}
          onKeyDown={onKeyDown}
          placeholder={chips.length ? "" : `${DEFAULT_TAG} (2차 태그)`}
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label="2차 태그 (선택, #단어 후 Space로 추가)"
          autoComplete="off"
          className="h-full min-w-16 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-2/70"
        />
      </div>

      {showing && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-11 z-40 max-h-64 w-56 overflow-y-auto rounded-xl border border-white/40 bg-white/90 p-1.5 shadow-2xl backdrop-blur-xl scroll-thin"
        >
          <li className="px-2 pb-1 pt-0.5 text-[11px] text-ink-2">기존 태그 · ↑↓ 선택 · Space 칩 · Enter 제출</li>
          {suggestions.map((tag, i) => (
            <li
              key={tag}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                addChips([tag]);
                onDraftChange("#");
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "cursor-pointer rounded-lg px-2 py-1.5 text-sm",
                i === active ? "bg-apple-blue/10 text-apple-blue" : "text-ink",
              )}
            >
              #{tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
