"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { BrandMark } from "@/components/ui/Brand";
import { ASSISTANT_NAME, useAssistant } from "@/store/assistant";

/**
 * PC·태블릿(md 이상) 우측 하단 O.E. Manager 트리거.
 * 누르면 우측 메모 패널 자리가 같은 크기의 대화창으로 바뀌고(Cockpit), 열려 있으면 X로 바뀌어 다시 메모로 돌아감.
 * 모바일은 하단 탭(MobileTabBar)이 대신하므로 숨김.
 */
export function FloatingAssistant() {
  const open = useAssistant((s) => s.open);
  const setOpen = useAssistant((s) => s.setOpen);

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label={open ? `${ASSISTANT_NAME} 닫고 메모로 돌아가기` : `${ASSISTANT_NAME} 열기`}
      aria-expanded={open}
      title={ASSISTANT_NAME}
      data-keep-selection
      className={cn(
        "fixed bottom-5 right-5 z-40 hidden size-14 items-center justify-center rounded-xl md:flex print:hidden",
        // 매트한 입체감: 위쪽 은은한 하이라이트 + 아래쪽 안쪽 음영 + 부드러운 바닥 그림자 (광택·그라데이션 없음)
        "bg-[#262626] text-white",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.10),inset_0_-3px_0_rgb(0_0_0/0.28),0_2px_4px_rgb(0_0_0/0.16),0_10px_24px_-8px_rgb(0_0_0/0.38)]",
        "transition-[background-color,transform,box-shadow] duration-150 hover:bg-[#2f2f2f]",
        "active:translate-y-px active:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),inset_0_-1px_0_rgb(0_0_0/0.28),0_1px_2px_rgb(0_0_0/0.18),0_4px_12px_-6px_rgb(0_0_0/0.35)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#262626]/40 focus-visible:ring-offset-2",
      )}
    >
      {open ? <X className="size-5" strokeWidth={2} /> : <BrandMark className="w-[30px] text-white" />}
    </button>
  );
}
