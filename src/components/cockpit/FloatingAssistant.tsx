"use client";

import { useEffect } from "react";

import { cn } from "@/lib/cn";
import { OEBuddy } from "@/components/ui/OEBuddy";
import { ASSISTANT_NAME, useAssistant } from "@/store/assistant";

/** 대화창 헤더의 닫기 버튼이 닫은 뒤 포커스를 돌려줄 대상 */
export const OE_TRIGGER_ID = "oe-buddy-trigger";

/** 글자를 입력 중인 요소 (이때는 A 단축키를 무시) */
const isTyping = (el: Element | null) =>
  !!el &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);

/** 대화창을 닫고 원래 세부 메모로 — 다시 나타나는 트리거로 포커스 복귀 */
function closeAssistant() {
  useAssistant.getState().setOpen(false);
  requestAnimationFrame(() => document.getElementById(OE_TRIGGER_ID)?.focus());
}

/**
 * PC 단축키: A = O.E. Buddy 열기/닫기 토글, Esc = 열려 있으면 닫기.
 * - 물리 키(e.code === "KeyA") 기준이라 한글 입력 상태에서도 동작
 * - 입력창·텍스트 영역·선택 상자·편집 가능한 영역에 포커스가 있거나 Ctrl/⌘/Alt 조합이면 무시 (Ctrl+A 전체 선택 등)
 * - 모달이 떠 있으면 무시
 * - 여는 순간 대화창 입력창으로 포커스 (AssistantChat이 열리며 맞춤). 눌린 'a'가 입력창에 들어가지 않도록 기본 동작 차단
 * Cockpit에서 선택 해제(Esc) 처리보다 먼저 등록해, 대화창을 닫는 Esc가 다른 Esc 동작까지 일으키지 않게 함.
 */
export function useAssistantHotkey(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      const { open, setOpen } = useAssistant.getState();

      if (e.key === "Escape" && open && !e.isComposing) {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeAssistant();
        return;
      }

      if (e.code !== "KeyA" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTyping(document.activeElement) || isTyping(e.target as Element | null)) return;
      e.preventDefault();
      if (open) closeAssistant();
      else setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/**
 * PC·태블릿(md 이상) O.E. Buddy 트리거.
 * 누르면 우측 메모 패널 자리가 같은 크기의 대화창으로 바뀜(Cockpit).
 * 대화창이 열려 있는 동안에는 숨기고, 닫기는 대화창 헤더의 X가 맡음 → 입력창·전송 버튼을 가리지 않음.
 * 모바일은 하단 탭(MobileTabBar)이 대신하므로 숨김.
 *
 * 모양: 바탕 없이 3D 캐릭터만 떠 있음(투명 56×56 클릭 영역). 4.5초마다 "쿵, 쿵" 뛰고(globals.css oe-hop),
 * 마우스를 올리거나 포커스하면 멈춤. 움직임 줄이기 설정이면 정지.
 */
export function FloatingAssistant() {
  const open = useAssistant((s) => s.open);
  const setOpen = useAssistant((s) => s.setOpen);

  return (
    <div
      className={cn("oe-hop-wrap fixed bottom-[88px] right-11 z-40 hidden print:hidden", !open && "md:block")}
      data-keep-selection
      data-tour="buddy"
    >
      {/* 발밑 타원 그림자: 점프 높이에 맞춰 작아지고 옅어졌다가 착지하면 다시 커짐 */}
      <span
        aria-hidden
        className="oe-hop-shadow pointer-events-none absolute inset-x-0 -bottom-1 mx-auto h-2 w-10 rounded-[50%] bg-[#00534f]/25 blur-[2px]"
      />
      {/* 바탕·글자 없이 캐릭터만 보임. 클릭 영역은 투명한 56×56, 이름은 화면에 보이지 않는 aria-label로만 */}
      <button
        id={OE_TRIGGER_ID}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ASSISTANT_NAME}
        aria-keyshortcuts="A"
        aria-expanded={open}
        className={cn(
          "oe-hop group relative flex size-14 items-end justify-center rounded-lg bg-transparent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-mint/60 focus-visible:ring-offset-2",
        )}
      >
        <span className="flex items-end justify-center transition-transform duration-100 group-hover:scale-[1.04] group-active:scale-[0.92]">
          {/* 투명 배경 PNG. 흰 메모 바탕·글씨 위에서도 형태가 또렷하도록 부드러운 drop-shadow */}
          <OEBuddy variant="full" size={52} priority className="drop-shadow-[0_2px_3px_rgb(0_83_79/0.28)]" />
        </span>
      </button>
    </div>
  );
}
