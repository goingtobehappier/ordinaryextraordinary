"use client";

import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { inline } from "./Markdown";

/**
 * 서식 편집기: 마크다운을 줄 단위로 편집하되 기호 대신 서식으로 보여 줌.
 *  - "## 제목" → 큰 제목(기호 숨김), "- 항목" → 불릿 점, "- [ ] 할 일" → 체크박스, "1. 항목" → 번호
 *  - 저장 형식은 그대로 마크다운 (미리보기·요약·검색과 호환)
 *  - 빈 줄에서 "# ", "- ", "1. ", "- [ ] "를 입력하면 바로 해당 서식으로 바뀜
 *  - 포커스가 없는 줄은 **굵게** 등 인라인 서식도 렌더링, 편집 중인 줄만 원문 표시
 */

type Line =
  | { kind: "h"; level: number; text: string }
  | { kind: "task"; indent: string; marker: string; done: boolean; text: string }
  | { kind: "ul"; indent: string; marker: string; text: string }
  | { kind: "ol"; indent: string; n: number; delim: string; text: string }
  | { kind: "p"; text: string };

function parse(raw: string): Line {
  let m = /^(#{1,6})\s(.*)$/.exec(raw);
  if (m) return { kind: "h", level: m[1].length, text: m[2] };
  m = /^(\s*)([-*+])\s\[([ xX])\](?:\s(.*))?$/.exec(raw);
  if (m) return { kind: "task", indent: m[1], marker: m[2], done: m[3] !== " ", text: m[4] ?? "" };
  m = /^(\s*)([-*+])\s(.*)$/.exec(raw);
  if (m) return { kind: "ul", indent: m[1], marker: m[2], text: m[3] };
  m = /^(\s*)(\d{1,4})([.)])\s(.*)$/.exec(raw);
  if (m) return { kind: "ol", indent: m[1], n: Number(m[2]), delim: m[3], text: m[4] };
  return { kind: "p", text: raw };
}

function prefix(l: Line): string {
  switch (l.kind) {
    case "h":
      return `${"#".repeat(l.level)} `;
    case "task":
      return `${l.indent}${l.marker} [${l.done ? "x" : " "}] `;
    case "ul":
      return `${l.indent}${l.marker} `;
    case "ol":
      return `${l.indent}${l.n}${l.delim} `;
    default:
      return "";
  }
}

const serialize = (l: Line) => prefix(l) + l.text;
const isList = (l: Line) => l.kind === "ul" || l.kind === "task" || l.kind === "ol";
const depthOf = (l: Line) => (isList(l) ? Math.floor((l as { indent: string }).indent.replace(/\t/g, "  ").length / 2) : 0);

/** 같은 종류로 이어지는 다음 줄 (Enter) */
function continuation(l: Line, text: string): Line {
  if (l.kind === "ul") return { ...l, text };
  if (l.kind === "task") return { ...l, done: false, text };
  if (l.kind === "ol") return { ...l, n: l.n + 1, text };
  return { kind: "p", text };
}

/** 섹션 제목에 맞춘 빈 항목 안내 문구 */
const SECTION_HINTS: [RegExp, string][] = [
  [/주요\s*사항/, "오늘의 핵심 업무 · 중요 이슈"],
  [/회고/, "오늘 하루 피드백 · 잘한 점 / 개선점"],
];

function hintFor(lines: Line[], i: number): string | undefined {
  const l = lines[i];
  if (l.kind === "h") return "제목";
  if (lines.length === 1 && l.kind === "p") return "오늘의 기록을 남겨보세요 · ‘# ’ 제목, ‘- ’ 목록, ‘- [ ] ’ 체크";
  if (!isList(l)) return undefined;
  for (let k = i - 1; k >= 0; k--) {
    const prev = lines[k];
    if (prev.kind === "h") return SECTION_HINTS.find(([re]) => re.test(prev.text))?.[1] ?? "항목 입력";
  }
  return "항목 입력";
}

const HEADING_CLS = [
  "text-[20px] font-bold tracking-[-0.02em]",
  "text-[17px] font-semibold tracking-[-0.01em]",
  "text-[15.5px] font-semibold",
  "text-sm font-semibold",
  "text-sm font-semibold text-ink-2",
  "text-xs font-semibold uppercase text-ink-2",
];

const HAS_INLINE = /[`*~_]|\]\(|https?:\/\//;

/** 줄 입력칸에 포커스 + 커서 위치 */
function focusInput(el: HTMLTextAreaElement | null | undefined, pos: number) {
  if (!el) return;
  el.focus();
  const p = Math.max(0, Math.min(pos, el.value.length));
  el.setSelectionRange(p, p);
}

/** 줄바꿈되는 긴 줄에 맞춰 입력칸 높이 조정 */
function fitHeights(els: (HTMLTextAreaElement | null)[]) {
  for (const el of els) {
    if (!el) continue;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }
}

export type LiveNoteEditorHandle = { focusEnd: () => void };

export function LiveNoteEditor({
  value,
  onChange,
  onBlur,
  disabled,
  ref,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  ref?: Ref<LiveNoteEditorHandle>;
}) {
  const raws = value.split("\n");
  const lines = raws.map(parse);
  const inputs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ line: number; pos: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const focusLine = (line: number, pos: number) => focusInput(inputs.current[line], pos);

  useImperativeHandle(ref, () => ({
    focusEnd: () => {
      const last = lines.length - 1;
      focusLine(last, lines[last].text.length);
    },
  }));

  // 줄 높이 자동 맞춤 (줄바꿈되는 긴 문장) + 대기 중인 커서 이동 적용
  useLayoutEffect(() => {
    fitHeights(inputs.current);
    if (pending.current) {
      const { line, pos } = pending.current;
      pending.current = null;
      focusLine(line, pos);
    }
  });

  // 패널 폭이 바뀌면 줄바꿈 높이 재계산
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      fitHeights(inputs.current);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function commit(next: Line[], caret?: { line: number; pos: number }) {
    if (caret) pending.current = caret;
    // 건드리지 않은 줄은 원문 그대로 (탭·공백 등 작성 방식 보존)
    onChange(next.map((l) => {
      const idx = lines.indexOf(l);
      return idx >= 0 ? raws[idx] : serialize(l);
    }).join("\n"));
  }

  /** 줄 텍스트 변경. 빈 문단에서 "- " 같은 기호를 치면 서식으로 바뀌므로 커서를 보정 */
  function editText(i: number, text: string, caret: number) {
    const raw = prefix(lines[i]) + text;
    const reparsed = parse(raw);
    const next = [...lines];
    next[i] = reparsed;
    const shift = prefix(reparsed).length - prefix(lines[i]).length;
    commit(next, shift ? { line: i, pos: caret - shift } : undefined);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, i: number) {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = el;
    const l = lines[i];

    if (e.key === "Enter") {
      e.preventDefault();
      // 빈 목록 항목에서 Enter → 목록 종료
      if (isList(l) && !l.text && !e.shiftKey) {
        const next = [...lines];
        next[i] = { kind: "p", text: "" };
        commit(next, { line: i, pos: 0 });
        return;
      }
      const next = [...lines];
      next[i] = { ...l, text: l.text.slice(0, s) } as Line;
      next.splice(i + 1, 0, e.shiftKey ? { kind: "p", text: l.text.slice(end) } : continuation(l, l.text.slice(end)));
      commit(next, { line: i + 1, pos: 0 });
      return;
    }

    if (e.key === "Backspace" && s === 0 && end === 0) {
      // 서식 줄 맨 앞 → 서식만 제거 / 문단 맨 앞 → 윗줄과 합치기
      if (l.kind !== "p") {
        e.preventDefault();
        const next = [...lines];
        next[i] = { kind: "p", text: l.text };
        commit(next, { line: i, pos: 0 });
      } else if (i > 0) {
        e.preventDefault();
        const next = [...lines];
        const prev = next[i - 1];
        next[i - 1] = { ...prev, text: prev.text + l.text } as Line;
        next.splice(i, 1);
        commit(next, { line: i - 1, pos: prev.text.length });
      }
      return;
    }

    if (e.key === "Delete" && s === l.text.length && end === s && i < lines.length - 1) {
      e.preventDefault();
      const next = [...lines];
      next[i] = { ...l, text: l.text + lines[i + 1].text } as Line;
      next.splice(i + 1, 1);
      commit(next, { line: i, pos: s });
      return;
    }

    if ((e.key === "Tab") && isList(l)) {
      e.preventDefault();
      const indent = (l as { indent: string }).indent;
      const nextIndent = e.shiftKey ? indent.slice(0, Math.max(0, indent.length - 2)) : depthOf(l) < 4 ? `${indent}  ` : indent;
      const next = [...lines];
      next[i] = { ...l, indent: nextIndent } as Line;
      commit(next, { line: i, pos: s });
      return;
    }

    // 위·아래 줄 이동: 한 줄짜리이거나 커서가 맨 앞/끝일 때
    const singleRow = el.scrollHeight <= parseFloat(getComputedStyle(el).lineHeight) * 1.6;
    if (e.key === "ArrowUp" && i > 0 && (singleRow || s === 0)) {
      e.preventDefault();
      focusLine(i - 1, s);
    } else if (e.key === "ArrowDown" && i < lines.length - 1 && (singleRow || s === l.text.length)) {
      e.preventDefault();
      focusLine(i + 1, s);
    } else if (e.key === "Escape") {
      el.blur();
    }
  }

  /** 여러 줄 붙여넣기 → 줄 단위로 나눠 삽입 (각 줄은 마크다운으로 해석) */
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>, i: number) {
    const text = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    if (!text.includes("\n")) return;
    e.preventDefault();
    const el = e.currentTarget;
    const l = lines[i];
    const before = l.text.slice(0, el.selectionStart);
    const after = l.text.slice(el.selectionEnd);
    const parts = text.split("\n");
    const first = { ...l, text: before + parts[0] } as Line;
    const middle = parts.slice(1, -1).map(parse);
    const lastRaw = parts[parts.length - 1];
    const last = parse(lastRaw + after);
    const next = [...lines];
    next.splice(i, 1, first, ...middle, last);
    commit(next, { line: i + parts.length - 1, pos: last.text.length - after.length });
  }

  function toggleTask(i: number) {
    const l = lines[i];
    if (l.kind !== "task") return;
    const next = [...lines];
    next[i] = { ...l, done: !l.done };
    commit(next);
  }

  return (
    <div
      ref={containerRef}
      data-note-live
      className="h-full overflow-y-auto px-4 py-4 text-[14px] leading-[1.7] text-ink sm:px-5 scroll-thin"
      onMouseDown={(e) => {
        // 마지막 줄 아래 빈 공간 클릭 → 마지막 줄 끝으로
        if (e.target === e.currentTarget && !disabled) {
          e.preventDefault();
          focusLine(lines.length - 1, lines[lines.length - 1].text.length);
        }
      }}
    >
      {lines.map((l, i) => {
        const isActive = active === i;
        const showRendered = !isActive && HAS_INLINE.test(l.text);
        const hint = hintFor(lines, i);
        return (
          <div
            key={i}
            className={cn("flex min-w-0 items-start gap-2", l.kind === "h" && (i > 0 ? "mt-3" : ""), l.kind === "h" && "mb-0.5")}
            style={{ paddingLeft: depthOf(l) * 18 }}
          >
            {/* 서식 표시 (구조를 항상 같게 유지해 입력칸이 다시 마운트되지 않도록) */}
            <span className={cn("flex shrink-0 select-none justify-center", l.kind === "h" || l.kind === "p" ? "w-0" : "w-4")} aria-hidden={l.kind !== "task"}>
              {l.kind === "ul" && <span className="mt-[10px] size-[5px] rounded-full bg-ink/50" />}
              {l.kind === "ol" && <span className="tabular-nums text-ink-2">{l.n}.</span>}
              {l.kind === "task" && (
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggleTask(i)}
                  className={cn(
                    "mt-[4px] flex size-4 items-center justify-center rounded-[5px] border-[1.5px] transition-colors",
                    l.done ? "border-apple-mint bg-apple-mint" : "border-black/25 hover:border-apple-mint",
                  )}
                  aria-label={l.done ? "체크 해제" : "체크"}
                >
                  <Check className={cn("size-3 text-white", !l.done && "opacity-0")} strokeWidth={3} />
                </button>
              )}
            </span>
            <div className="relative min-w-0 flex-1">
              <textarea
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                rows={1}
                value={l.text}
                disabled={disabled}
                spellCheck={false}
                placeholder={l.text ? undefined : hint}
                aria-label={l.kind === "h" ? `제목 ${l.level}` : l.kind === "p" ? "문단" : "목록 항목"}
                onChange={(e) => editText(i, e.target.value, e.target.selectionStart)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onPaste={(e) => onPaste(e, i)}
                onFocus={() => setActive(i)}
                onBlur={() => {
                  setActive((a) => (a === i ? null : a));
                  onBlur?.();
                }}
                className={cn(
                  "block w-full resize-none overflow-hidden break-keep bg-transparent p-0 outline-none placeholder:font-normal placeholder:text-ink-2/50",
                  l.kind === "h" && HEADING_CLS[l.level - 1],
                  l.kind === "task" && l.done && "text-ink-2 line-through",
                  showRendered && "text-transparent caret-transparent",
                )}
              />
              {showRendered && (
                <div
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-0 whitespace-pre-wrap break-keep",
                    l.kind === "h" && HEADING_CLS[l.level - 1],
                    l.kind === "task" && l.done && "text-ink-2 line-through",
                  )}
                >
                  {inline(l.text)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
