"use client";

import { useEffect, useRef } from "react";

const CODE_KEYS: Record<string, string> = {
  Slash: "/",
  Period: ".",
  Comma: ",",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Space: "Space",
};

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "Process"]);

/**
 * KeyboardEvent → "Ctrl+Alt+Shift+Meta+Key" 문자열.
 * 한글 IME 상태에서도 동작하도록 e.key 대신 물리 키(e.code)를 사용합니다.
 * 수정자 키만 눌린 경우 null.
 */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key: string;
  if (e.code.startsWith("Key")) key = e.code.slice(3);
  else if (e.code.startsWith("Digit")) key = e.code.slice(5);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else key = e.code || e.key; // ArrowLeft, Enter, Escape, F1 …

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

/** 단독 키로 쓰면 입력·조작과 충돌하는 키 */
const RESERVED_SINGLE = new Set(["Escape", "Enter", "Tab", "Backspace", "Delete", "Space"]);

/** 단축키로 등록 가능한 조합인지: 수정자 조합이거나, 예약되지 않은 단일 키 */
export function isBindableCombo(combo: string) {
  return hasModifier(combo) || !RESERVED_SINGLE.has(combo);
}

/** 텍스트를 입력 중인 요소인지 (input / textarea / select / contenteditable) */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    // 체크박스·버튼류 input은 글자를 입력하지 않으므로 제외
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

export function hasModifier(combo: string) {
  return /^(Ctrl|Alt|Shift|Meta)\+/.test(combo);
}

export function formatCombo(combo: string) {
  return combo
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")
    .split("+");
}

/**
 * 전역 키 바인딩. bindings: combo → handler
 * - 수정자 없는 단일 키(예: N)는 입력창(input/textarea/contenteditable)에 포커스가 있으면 무시
 *   → 글자가 그대로 입력됨
 * - Alt/Ctrl 등 수정자 조합은 글자를 입력하지 않으므로 입력창 안에서도 동작
 */
export function useHotkeys(bindings: Record<string, () => void>, enabled = true) {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing && !e.altKey && !e.ctrlKey && !e.metaKey) return;
      // 확인 다이얼로그(삭제 확인 등)가 열려 있으면 전역 단축키 중지
      if (document.querySelector('[role="alertdialog"]')) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (!hasModifier(combo)) {
        // 텍스트 입력 중이면 단축키 무시 (activeElement + 이벤트 대상 모두 확인)
        if (isTypingTarget(document.activeElement) || isTypingTarget(e.target as Element)) return;
        if (e.repeat) return; // 키를 누르고 있을 때 반복 실행 방지
      }
      const handler = ref.current[combo];
      if (handler) {
        e.preventDefault();
        e.stopPropagation();
        handler();
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [enabled]);
}
