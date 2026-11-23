"use client";

import { cn } from "@/lib/cn";
import { OEBuddy } from "@/components/ui/OEBuddy";
import { ASSISTANT_NAME, useAssistant } from "@/store/assistant";

/** 대화창 헤더의 닫기 버튼이 닫은 뒤 포커스를 돌려줄 대상 */
export const OE_TRIGGER_ID = "oe-buddy-trigger";

/**
 * PC·태블릿(md 이상) O.E. Buddy 트리거.
 * 누르면 우측 메모 패널 자리가 같은 크기의 대화창으로 바뀜(Cockpit).
 * 대화창이 열려 있는 동안에는 숨기고, 닫기는 대화창 헤더의 X가 맡음 → 입력창·전송 버튼을 가리지 않음.
 * 모바일은 하단 탭(MobileTabBar)이 대신하므로 숨김.
 *
 * 모양: 뒤가 은은하게 비치는 프로스트 글래스 + 3D 캐릭터. 4.5초마다 "쿵, 쿵" 뛰고(globals.css oe-hop),
 * 마우스를 올리거나 포커스하면 멈춤. 움직임 줄이기 설정이면 정지.
 */
export function FloatingAssistant() {
  const open = useAssistant((s) => s.open);
  const setOpen = useAssistant((s) => s.setOpen);

  return (
    <div
      className={cn("oe-hop-wrap fixed bottom-[88px] right-11 z-40 hidden print:hidden", !open && "md:block")}
      data-keep-selection
    >
      {/* 바닥 그림자: 점프 높이에 맞춰 작아졌다 커짐 */}
      <span
        aria-hidden
        className="oe-hop-shadow pointer-events-none absolute inset-x-0 -bottom-2.5 mx-auto h-2.5 w-11 rounded-[50%] bg-black/20 blur-[3px]"
      />
      <button
        id={OE_TRIGGER_ID}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${ASSISTANT_NAME} 열기`}
        aria-expanded={open}
        title={ASSISTANT_NAME}
        className={cn(
          "oe-hop group relative flex size-14 items-center justify-center rounded-[8px]",
          // 프로스트 글래스: 반투명 흰 바탕 + 블러, 위쪽 밝은 테두리·아래쪽 옅은 음영으로 두께감
          "border border-white/80 bg-white/80 backdrop-blur-md",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.95),inset_0_-2px_0_rgb(0_0_0/0.04),0_0_0_1px_rgb(0_0_0/0.06),0_10px_24px_-10px_rgb(0_0_0/0.28)]",
          "transition-[background-color,box-shadow] duration-150 hover:bg-white/90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/50 focus-visible:ring-offset-2",
        )}
      >
        <span className="flex items-center justify-center transition-transform duration-100 group-active:scale-[0.92]">
          <OEBuddy className="w-10" />
        </span>
      </button>
    </div>
  );
}
