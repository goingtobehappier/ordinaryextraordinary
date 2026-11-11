/** Daily Memopad 하단 서식 힌트 → 커서 위치에 마크다운 문법 삽입 */

export type NoteSyntax = "heading" | "bold" | "bullet" | "quote" | "task";

export const NOTE_SYNTAX_HINTS: { kind: NoteSyntax; label: string; title: string }[] = [
  { kind: "heading", label: "# 제목", title: "현재 줄을 제목으로" },
  { kind: "bold", label: "**굵게**", title: "선택한 글자를 굵게 (선택이 없으면 커서 위치에 삽입)" },
  { kind: "bullet", label: "- 불릿", title: "현재 줄을 불릿 목록으로" },
  { kind: "quote", label: "> 인용문", title: "현재 줄을 인용문으로" },
  { kind: "task", label: "[ ] 체크박스", title: "현재 줄을 체크박스로" },
];

/** 줄 앞의 기존 블록 기호 (들여쓰기 + 제목/체크/불릿/인용/번호) */
const BLOCK_PREFIX = /^(\s*)(#{1,6}\s|[-*+]\s\[[ xX]\]\s|[-*+]\s|>\s?|\d{1,4}[.)]\s)?/;

const BLOCK: Record<Exclude<NoteSyntax, "bold">, { prefix: string; same: RegExp }> = {
  heading: { prefix: "# ", same: /^#{1,6}\s$/ },
  bullet: { prefix: "- ", same: /^[-*+]\s$/ },
  task: { prefix: "- [ ] ", same: /^[-*+]\s\[[ xX]\]\s$/ },
  quote: { prefix: "> ", same: /^>\s?$/ },
};

/**
 * 한 줄(또는 텍스트)에 문법 적용. start/end는 선택 범위, 반환값 caret은 적용 후 커서 위치.
 *  - bold: 선택 범위를 **로 감싸거나, 선택이 없으면 **** 사이에 커서
 *  - 블록 문법: 기존 블록 기호를 바꿔 끼움. 이미 같은 서식이면 해제(토글)
 */
export function applySyntax(text: string, start: number, end: number, kind: NoteSyntax): { text: string; caret: number } {
  if (kind === "bold") {
    const sel = text.slice(start, end);
    return { text: `${text.slice(0, start)}**${sel}**${text.slice(end)}`, caret: sel ? end + 4 : start + 2 };
  }
  const m = BLOCK_PREFIX.exec(text)!;
  const indent = m[1];
  const old = m[2] ?? "";
  const { prefix, same } = BLOCK[kind];
  // 제목은 들여쓰기 없이, 목록·인용은 들여쓰기 유지
  const head = (kind === "heading" ? "" : indent) + (same.test(old) ? "" : prefix);
  const oldLen = indent.length + old.length;
  const caret = start < oldLen ? head.length : start - oldLen + head.length;
  return { text: head + text.slice(oldLen), caret };
}
