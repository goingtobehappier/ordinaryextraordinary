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
    >
      {/* 발밑 타원 그림자: 점프 높이에 맞춰 작아지고 옅어졌다가 착지하면 다시 커짐 */}
      <span
        aria-hidden
        className="oe-hop-shadow pointer-events-none absolute inset-x-0 -bottom-1 mx-auto h-2 w-10 rounded-[50%] bg-[#00534f]/25 blur-[2px]"
      />
      {/* 바탕 없이 캐릭터만 보임. 클릭 영역은 투명한 56×56 그대로 */}
      <button
        id={OE_TRIGGER_ID}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${ASSISTANT_NAME} 열기`}
        aria-expanded={open}
        title={ASSISTANT_NAME}
        className={cn(
          "oe-hop group relative flex size-14 items-end justify-center rounded-[8px] bg-transparent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-mint/60 focus-visible:ring-offset-2",
        )}
      >
        <span className="flex items-end justify-center transition-transform duration-100 group-hover:scale-[1.04] group-active:scale-[0.92]">
          {/* 흰 메모 바탕·글씨 위에서도 형태가 또렷하도록 부드러운 drop-shadow */}
          <OEBuddy className="w-[52px] drop-shadow-[0_2px_3px_rgb(0_83_79/0.28)]" />
        </span>
      </button>
    </div>
  );
}
