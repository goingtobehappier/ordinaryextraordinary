"use client";

import { forwardRef, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CATEGORIES, CATEGORY_STYLE, DEFAULT_CATEGORY, type Category } from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  value: Category | null;
  onChange: (c: Category) => void;
  /** 선택 확정 후 (Enter / 숫자키 / 클릭) → 다음 입력으로 */
  onDone: () => void;
  className?: string;
};

/**
 * 1차 태그 선택 (필수).
 * ↑↓←→ 이동 · 1~6 바로 선택 · Enter 확정 (아무것도 고르지 않으면 '업무')
 */
export const CategoryPicker = forwardRef<HTMLButtonElement, Props>(function CategoryPicker(
  { value, onChange, onDone, className },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  function choose(c: Category) {
    onChange(c);
    setOpen(false);
    setActive(-1);
    onDone();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.nativeEvent.isComposing) return;
    const n = CATEGORIES.length;
    if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key) && !e.altKey) {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
      setActive((i) => {
        const base = i >= 0 ? i : value ? CATEGORIES.indexOf(value) : step > 0 ? -1 : 0;
        return (base + step + n) % n;
      });
    } else if (/^[1-6]$/.test(e.key) && !e.altKey && !e.ctrlKey) {
      e.preventDefault();
      choose(CATEGORIES[Number(e.key) - 1]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active >= 0 ? CATEGORIES[active] : (value ?? DEFAULT_CATEGORY));
    } else if (e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    } else if (e.key === "Escape") {
      if (open) {
        e.stopPropagation(); // 드롭다운만 닫고 선택 해제(ESC)는 막음
        setOpen(false);
      }
      else e.currentTarget.blur();
    }
  }

  const shown = value ?? null;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={ref}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="1차 태그 (필수)"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className="flex h-9 w-full items-center gap-1.5 rounded-lg border border-black/5 bg-white/60 pl-2 pr-1.5 text-sm outline-none transition-[box-shadow,background-color] focus:bg-white/90 focus:ring-2 focus:ring-apple-blue/40"
      >
        {shown ? (
          <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold", CATEGORY_STYLE[shown].badge)}>{shown}</span>
        ) : (
          <span className="text-ink-2/70">{DEFAULT_CATEGORY}</span>
        )}
        <span className="ml-auto rounded bg-apple-blue/10 px-1 text-[10px] font-semibold text-apple-blue">필수</span>
        <ChevronDown className="size-3.5 text-ink-2" />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-11 z-40 w-52 rounded-xl border border-white/40 bg-white/90 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          <li className="px-2 pb-1 pt-0.5 text-[11px] text-ink-2">1차 태그 · 숫자키 선택 · Enter = {value ?? DEFAULT_CATEGORY}</li>
          {CATEGORIES.map((c, i) => (
            <li
              key={c}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={c === value}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                i === active ? "bg-apple-blue/10" : c === value && "bg-black/[0.04]",
              )}
            >
              <span className={cn("size-2 rounded-full", CATEGORY_STYLE[c].dot)} />
              <span className="flex-1">{c}</span>
              <kbd className="font-mono text-[11px] text-ink-2">{i + 1}</kbd>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
