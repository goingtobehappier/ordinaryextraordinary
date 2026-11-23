"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Todo } from "@/lib/types";
import type { TodoPatch } from "@/store/cockpit";

/** 서버(assistant/tools.ts)와 같은 기준: '#' 제거, 쉼표·괄호 등 필터를 깨는 문자 제외, 길이·개수 제한 */
const CHIP_MAX_LEN = 40;
const CHIP_LIMIT = 20;
const cleanChip = (v: string) =>
  v
    .replace(/[,()*%\\"{}]/g, " ")
    .trim()
    .replace(/^#+/, "")
    .slice(0, CHIP_MAX_LEN)
    .trim();

function addChips(list: string[], raw: string): string[] {
  const next = [...list];
  for (const part of raw.split(",")) {
    const v = cleanChip(part);
    if (v && !next.includes(v) && next.length < CHIP_LIMIT) next.push(v);
  }
  return next;
}

type Tone = "tool" | "tag";
const CHIP_TONE: Record<Tone, string> = {
  tool: "bg-black/[0.06] text-ink",
  tag: "bg-apple-blue/10 text-[#0062cc]",
};

/**
 * 세컨드 브레인 회고 영역: 회고 메모(retrospective_memo) · 사용 도구(used_tools) · AI 태그(ai_tags).
 * 접힌 상태에서는 한 줄 요약, 펼치면 직접 수정. 세부 메모(todo_details.memo)와는 별개로 todos 행에 저장됨.
 */
export function SecondBrainSection({
  todo,
  open,
  onOpenChange,
  onPatch,
}: {
  todo: Todo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (patch: TodoPatch) => void;
}) {
  const memoValue = todo.retrospective_memo ?? "";
  const tools = todo.used_tools ?? [];
  const tags = todo.ai_tags ?? [];
  const regionId = useId();

  // 회고 메모 입력값: 바깥(AI·다른 기기)에서 바뀌면 입력값도 맞춤
  const [draft, setDraft] = useState(memoValue);
  const [synced, setSynced] = useState(memoValue);
  if (memoValue !== synced) {
    setSynced(memoValue);
    setDraft(memoValue);
  }

  const commitMemo = () => {
    const v = draft.trim();
    if (v === memoValue.trim()) return;
    onPatch({ retrospective_memo: v || null });
  };

  const empty = !memoValue && !tools.length && !tags.length;
  const preview = memoValue.split("\n").find((l) => l.trim()) ?? "";
  const chips = [...tools.map((t) => ({ t, tone: "tool" as const })), ...tags.map((t) => ({ t, tone: "tag" as const }))];
  const shown = chips.slice(0, 3);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-expanded={false}
        aria-controls={regionId}
        className="flex h-9 w-full shrink-0 items-center gap-2 rounded-xl border border-black/5 bg-white/40 px-3 text-left text-xs transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/40"
      >
        <span className="shrink-0 font-semibold text-ink-2">회고</span>
        {empty ? (
          <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-ink-2/80">
            <Plus className="size-3 shrink-0" />
            회고 · 사용 도구 · AI 태그 추가
          </span>
        ) : (
          <>
            <span className={cn("min-w-0 flex-1 truncate", preview ? "text-ink" : "text-ink-2/80")}>{preview || "회고 메모 없음"}</span>
            <span className="hidden shrink-0 items-center gap-1 sm:flex">
              {shown.map(({ t, tone }) => (
                <span key={`${tone}:${t}`} className={cn("max-w-24 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium", CHIP_TONE[tone])}>
                  {t}
                </span>
              ))}
              {chips.length > shown.length && <span className="text-[11px] tabular-nums text-ink-2">+{chips.length - shown.length}</span>}
            </span>
          </>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-ink-2" />
      </button>
    );
  }

  return (
    <section id={regionId} aria-label="회고" className="flex shrink-0 flex-col gap-3 rounded-xl border border-black/5 bg-white/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-2">회고</span>
        <button
          type="button"
          onClick={() => {
            commitMemo();
            onOpenChange(false);
          }}
          aria-expanded
          className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-ink-2 transition-colors hover:bg-black/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/40"
        >
          접기
          <ChevronUp className="size-3.5" />
        </button>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitMemo}
        rows={3}
        maxLength={5000}
        placeholder="오늘 이 업무에서 배운 점·막힌 점·다음에 할 일"
        aria-label="회고 메모"
        className="resize-none rounded-lg border border-black/5 bg-white/60 px-2.5 py-2 text-sm leading-relaxed outline-none transition-[background-color,box-shadow] scroll-thin focus:bg-white/90 focus:ring-2 focus:ring-apple-blue/30"
      />

      <ChipField label="사용 도구" placeholder="도구 추가 (예: Figma)" tone="tool" values={tools} onChange={(v) => onPatch({ used_tools: v })} />
      <ChipField label="AI 태그" placeholder="태그 추가" tone="tag" values={tags} onChange={(v) => onPatch({ ai_tags: v })} />
    </section>
  );
}

function ChipField({
  label,
  placeholder,
  tone,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  tone: Tone;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const inputId = useId();

  const commit = () => {
    const next = addChips(values, input);
    setInput("");
    if (next.length !== values.length) onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !input && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[11px] font-medium text-ink-2">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={v} className={cn("inline-flex max-w-full items-center gap-0.5 rounded-md py-0.5 pl-2 pr-0.5 text-xs font-medium", CHIP_TONE[tone])}>
            <span className="truncate">{v}</span>
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`${label} ${v} 삭제`}
              className="flex size-5 shrink-0 items-center justify-center rounded opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/40"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={values.length >= CHIP_LIMIT ? "최대 개수" : placeholder}
          disabled={values.length >= CHIP_LIMIT}
          className="h-7 min-w-28 flex-1 rounded-md border border-black/5 bg-white/60 px-2 text-xs outline-none transition-[background-color,box-shadow] placeholder:text-ink-2/70 focus:bg-white/90 focus:ring-2 focus:ring-apple-blue/30"
        />
      </div>
    </div>
  );
}
