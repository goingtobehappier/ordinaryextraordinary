"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/cn";
import { BrandMark } from "@/components/ui/Brand";
import { ASSISTANT_NAME, useAssistant, type MobileTab } from "@/store/assistant";
import { AssistantChat } from "./AssistantChat";

/** 하단 탭 바 높이(px, safe-area 제외) — 본문 하단 여백과 맞춤 */
export const TAB_BAR_HEIGHT = 56;

/**
 * 가상 키보드 감지: visualViewport가 레이아웃 뷰포트보다 크게 줄면 키보드가 열린 것으로 봄.
 * iOS는 키보드가 화면을 덮기만 하고 100dvh를 줄이지 않으므로, 보이는 영역의 높이·위치를 직접 사용.
 */
function useVisualViewport() {
  const [vv, setVv] = useState<{ height: number; top: number; keyboard: boolean } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => setVv({ height: v.height, top: v.offsetTop, keyboard: window.innerHeight - v.height > 120 });
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, []);
  return vv;
}

/** 모바일 O.E. Buddy 탭: 탭 바 위 전체 화면 대화. 키보드가 열리면 보이는 영역에 맞춰 입력창이 키보드 바로 위에 옴 */
export function MobileManagerScreen({ active }: { active: boolean }) {
  const vv = useVisualViewport();
  const keyboard = !!vv?.keyboard;
  return (
    <div
      className={cn("fixed inset-x-0 top-0 z-30 flex flex-col bg-white md:hidden", !active && "hidden")}
      style={
        keyboard && vv
          ? { top: vv.top, height: vv.height }
          : { bottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` }
      }
    >
      <AssistantChat variant="screen" className="min-h-0 flex-1" />
    </div>
  );
}

const TABS: { id: MobileTab; label: string }[] = [
  { id: "manager", label: ASSISTANT_NAME },
  { id: "timeblock", label: "타임블록" },
];

/** 모바일(< md) 하단 2탭: O.E. Buddy / 타임블록. 키보드가 열려 있으면 숨겨 입력 영역을 확보 */
export function MobileTabBar() {
  const tab = useAssistant((s) => s.mobileTab);
  const setTab = useAssistant((s) => s.setMobileTab);
  const vv = useVisualViewport();
  if (vv?.keyboard) return null;

  return (
    <nav
      aria-label="모바일 화면 전환"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/[0.08] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden print:hidden"
      data-keep-selection
    >
      <div role="tablist" className="grid grid-cols-2" style={{ height: TAB_BAR_HEIGHT }}>
        {TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#262626]/30",
                selected ? "text-[#262626]" : "text-ink-2",
              )}
            >
              {t.id === "manager" ? (
                <span
                  className={cn(
                    "flex h-6 w-8 items-center justify-center rounded-md transition-colors",
                    selected ? "bg-[#262626] text-white" : "text-ink-2",
                  )}
                >
                  <BrandMark className="w-5 text-current" />
                </span>
              ) : (
                <span
                  className={cn(
                    "flex h-6 w-8 items-center justify-center rounded-md transition-colors",
                    selected ? "bg-[#262626] text-white" : "text-ink-2",
                  )}
                >
                  <CalendarClock className="size-4" />
                </span>
              )}
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
