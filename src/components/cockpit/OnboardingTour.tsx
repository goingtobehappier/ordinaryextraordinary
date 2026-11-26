"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCockpit, type MainView, type ViewMode } from "@/store/cockpit";
import { ASSISTANT_NAME, useAssistant, type MobileTab } from "@/store/assistant";
import { isOnboardingDone, markOnboardingDone, useOnboarding } from "@/store/onboarding";
import { useIsMobile } from "@/hooks/useIsMobile";
import { formatCombo } from "@/hooks/useHotkeys";
import { GlassButton, Kbd } from "@/components/ui/Glass";
import { OEBuddy } from "@/components/ui/OEBuddy";

/**
 * 첫 접속 온보딩: 환영 모달 → 5단계 스포트라이트 투어.
 * 실제 화면 요소(data-tour)를 딤 처리 위로 드러내 안내하며, DB에는 아무것도 쓰지 않음.
 * 투어 중 바꾸는 건 화면 상태(보기·Buddy 열림·모바일 탭)뿐이고 끝나면 원래대로 돌려놓음.
 */

type Step = {
  /** 찾을 data-tour 값. 앞에서부터 화면에 보이는 첫 요소를 강조 */
  targets: string[];
  title: string;
  body: ReactNode;
};

const keys = (combo: string) => (
  <span className="mx-0.5 inline-flex gap-0.5 align-[1px]">
    {formatCombo(combo).map((k) => (
      <Kbd key={k}>{k}</Kbd>
    ))}
  </span>
);

function useSteps(isMobile: boolean): Step[] {
  const sc = useCockpit((s) => s.shortcuts);
  if (isMobile) {
    return [
      {
        targets: ["buddy-tab"],
        title: "빠른 입력 & 자동 태그",
        body: (
          <>
            하단 <b className="font-semibold">{ASSISTANT_NAME}</b> 탭에서 “내일 3시 주간회의”처럼 적어 보내면 바로 등록되고, AI가 문맥을
            읽어 1차·2차 태그를 자동으로 달아줍니다.
          </>
        ),
      },
      {
        targets: ["buddy-tab"],
        title: `AI 비서 ${ASSISTANT_NAME}`,
        body: (
          <>
            같은 탭에서 일정 추가, 날짜 이동, 시간 지정, 세부 메모 작성, 삭제까지 채팅으로 한 번에 처리할 수 있습니다. 다른 탭을 누르면 언제든
            돌아옵니다.
          </>
        ),
      },
      {
        targets: ["timeblock"],
        title: "타임블록",
        body: (
          <>
            비어 있는 시간 칸을 탭하면 그 시간이 채워진 채로 {ASSISTANT_NAME}가 열려 바로 일정을 넣을 수 있습니다. 주말과 법정 공휴일에는 평일
            점심시간 블록이 자동으로 빠집니다.
          </>
        ),
      },
      {
        targets: ["views"],
        title: "일간 · 주간 · 월간 맞춤 보기",
        body: (
          <>
            위쪽 보기 전환 버튼을 탭해 집중 실행용 일간, 흐름을 보는 주간, 전체 일정과 공휴일을 보는 월간 화면으로 바꿔 보세요.
          </>
        ),
      },
      {
        targets: ["memo"],
        title: "세부 메모 공간",
        body: <>일정을 탭하면 세부 메모 창이 열려 회의록이나 체크리스트를 기록할 수 있고, 이 메모장에는 하루의 기록을 남길 수 있습니다.</>,
      },
    ];
  }
  return [
    {
      targets: ["quick-add"],
      title: "빠른 입력 & 자동 태그",
      body: (
        <>
          키보드 {keys(sc.newTodo)}을 누르면 바로 할 일을 입력할 수 있고, {keys("Enter")}를 누르면 등록과 동시에 AI가 문맥을 분석해 1차·2차
          태그를 자동으로 달아줍니다.
        </>
      ),
    },
    {
      targets: ["buddy"],
      title: `AI 비서 호출 · ${ASSISTANT_NAME}`,
      body: (
        <>
          키보드 {keys("A")}를 누르거나 우측 하단 민트 캐릭터를 클릭하면 {ASSISTANT_NAME}가 열립니다. 일정 추가, 날짜 이동, 시간 지정, 세부 메모
          작성, 삭제까지 채팅으로 한 번에 처리할 수 있습니다. {keys("Esc")}로 바로 닫힙니다.
        </>
      ),
    },
    {
      targets: ["timeblock"],
      title: "자유로운 타임블록 배치",
      body: (
        <>
          할 일을 타임블록 영역으로 끌어다 원하는 시간대에 놓고, 블록 끝을 끌어 길이를 조절할 수 있습니다. 주말과 법정 공휴일에는 평일
          점심시간 블록이 자동으로 빠집니다.
        </>
      ),
    },
    {
      targets: ["views"],
      title: "일간 · 주간 · 월간 맞춤 보기",
      body: (
        <>
          상단 보기 전환 메뉴로 집중 실행을 위한 일간{keys(sc.viewDay)}, 흐름 파악을 위한 주간{keys(sc.viewWeek)}, 전체 일정과 공휴일을 보는
          월간{keys(sc.viewMonth)} 화면을 자유롭게 오가 보세요.
        </>
      ),
    },
    {
      targets: ["memo"],
      title: "세부 메모 공간",
      body: (
        <>
          일정을 선택하면 세부 메모 패널이 열려 회의록이나 체크리스트를 상세히 기록할 수 있고, 우측 메모장에는 하루의 기록을 남길 수 있습니다.
        </>
      ),
    },
  ];
}

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(targets: string[]): HTMLElement | null {
  for (const t of targets) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${t}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 투어·모달이 떠 있는 동안 화면 단축키(N·A·Esc 등)가 아래 화면으로 새지 않도록 가로챔 */
function useKeyGuard(active: boolean, handlers: { esc: () => void; next?: () => void; prev?: () => void }) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // Tab·Enter·Space는 카드 안 버튼 조작에 필요하므로 통과
      if (e.key === "Tab" || e.key === "Enter" || e.key === " ") return;
      if (e.key === "Escape") ref.current.esc();
      else if (e.key === "ArrowRight" && ref.current.next) ref.current.next();
      else if (e.key === "ArrowLeft" && ref.current.prev) ref.current.prev();
      else if (e.key.length !== 1 && !e.key.startsWith("Arrow")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active]);
}

/** 카드 안에서만 Tab 포커스가 돌도록 */
function trapTab(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function OnboardingTour({ userId }: { userId: string }) {
  const phase = useOnboarding((s) => s.phase);
  const openWelcome = useOnboarding((s) => s.openWelcome);

  // 첫 접속자에게만 환영 모달 (완료 플래그는 사용자별)
  useEffect(() => {
    if (!isOnboardingDone(userId)) openWelcome();
  }, [userId, openWelcome]);

  if (phase === "welcome") return <WelcomeModal userId={userId} />;
  if (phase === "tour") return <SpotlightTour userId={userId} />;
  return null;
}

function WelcomeModal({ userId }: { userId: string }) {
  const startTour = useOnboarding((s) => s.startTour);
  const close = useOnboarding((s) => s.close);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const skip = () => {
    markOnboardingDone(userId);
    close();
  };
  useKeyGuard(true, { esc: skip });
  useEffect(() => primaryRef.current?.focus(), []);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-4 backdrop-blur-sm print:hidden">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="oe-welcome-title"
        aria-describedby="oe-welcome-desc"
        onKeyDown={trapTab}
        className="w-full max-w-[360px] rounded-[8px] border border-white/60 bg-white px-6 pb-5 pt-6 text-center shadow-2xl"
      >
        <OEBuddy variant="full" size={88} priority className="mx-auto drop-shadow-[0_2px_3px_rgb(0_83_79/0.2)]" />
        <h2 id="oe-welcome-title" className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-ink">
          튜토리얼을 보시겠습니까?
        </h2>
        <p id="oe-welcome-desc" className="mx-auto mt-1.5 max-w-[30ch] break-keep text-sm leading-relaxed text-ink-2">
          실제 화면 위에서 핵심 기능 다섯 가지를 차례로 짚어 드립니다. 1분이면 충분해요.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <GlassButton
            ref={primaryRef}
            variant="primary"
            className="h-10 w-full rounded-[8px]"
            onClick={() => startTour()}
          >
            튜토리얼 보기
          </GlassButton>
          <GlassButton className="h-10 w-full rounded-[8px]" onClick={skip}>
            건너뛰고 바로 시작
          </GlassButton>
        </div>
      </div>
    </div>
  );
}

const PAD = 6;
const GAP = 12;
const EDGE = 12;

function SpotlightTour({ userId }: { userId: string }) {
  const isMobile = useIsMobile();
  const steps = useSteps(isMobile);
  const close = useOnboarding((s) => s.close);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(220);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index === steps.length - 1;
  // 단계 배열은 렌더마다 새로 만들어지므로 effect 의존성은 문자열 키로
  const targetKey = step.targets.join("|");

  // 투어가 보여줄 화면으로 맞추고(일간/주간 · Buddy 닫힘 · 모바일 타임블록 탭), 끝나면 원래 화면으로 복원
  useEffect(() => {
    const cockpit = useCockpit.getState();
    const assistant = useAssistant.getState();
    const prev: { view: MainView; prevView: ViewMode; open: boolean; tab: MobileTab } = {
      view: cockpit.view,
      prevView: cockpit.prevView,
      open: assistant.open,
      tab: assistant.mobileTab,
    };
    if (prev.view !== "day" && prev.view !== "week") cockpit.setView("day");
    if (prev.open) assistant.setOpen(false);
    assistant.setMobileTab("timeblock");
    return () => {
      // 검색·요약 화면에서 시작했을 수도 있으므로 보기 상태를 그대로 되돌림
      useCockpit.setState({ view: prev.view, prevView: prev.prevView });
      useAssistant.getState().setOpen(prev.open);
      useAssistant.getState().setMobileTab(prev.tab);
    };
  }, []);

  const finish = () => {
    markOnboardingDone(userId);
    close();
  };
  const next = () => (last ? finish() : setIndex((i) => i + 1));
  const prev = () => setIndex((i) => Math.max(0, i - 1));
  useKeyGuard(true, { esc: finish, next, prev });

  // 단계가 바뀌면 대상 요소를 화면 안으로 스크롤하고 카드에 포커스
  useLayoutEffect(() => {
    const el = findTarget(targetKey.split("|"));
    el?.scrollIntoView({ block: "center", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    cardRef.current?.focus({ preventScroll: true });
  }, [index, targetKey]);

  // 대상 위치 추적: 스크롤·리사이즈·캐릭터 점프까지 따라가도록 매 프레임 측정 (변화가 있을 때만 렌더)
  useEffect(() => {
    let raf = 0;
    let lastKey = "";
    const targets = targetKey.split("|");
    const tick = () => {
      const el = findTarget(targets);
      const r = el?.getBoundingClientRect();
      const next: Rect | null = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      const h = cardRef.current?.offsetHeight ?? 220;
      const key = next
        ? `${Math.round(next.top)},${Math.round(next.left)},${Math.round(next.width)},${Math.round(next.height)},${h},${window.innerWidth},${window.innerHeight}`
        : `none,${h},${window.innerWidth},${window.innerHeight}`;
      if (key !== lastKey) {
        lastKey = key;
        setRect(next);
        setCardH(h);
        setVp({ w: window.innerWidth, h: window.innerHeight });
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [targetKey]);

  // 스포트라이트(대상 + 여백, 화면 밖은 잘라냄)
  const hole = rect && vp.w
    ? (() => {
        const top = Math.max(EDGE / 2, rect.top - PAD);
        const left = Math.max(EDGE / 2, rect.left - PAD);
        const bottom = Math.min(vp.h - EDGE / 2, rect.top + rect.height + PAD);
        const right = Math.min(vp.w - EDGE / 2, rect.left + rect.width + PAD);
        return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      })()
    : null;

  // 카드 위치: 아래 → 위 → (공간이 없으면) 화면 하단 고정. 대상이 없으면 화면 중앙
  const cardW = Math.min(360, (vp.w || 360) - EDGE * 2);
  let cardStyle: React.CSSProperties;
  if (!hole) {
    cardStyle = { width: cardW, left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  } else {
    const below = hole.top + hole.height + GAP;
    const above = hole.top - GAP - cardH;
    const top =
      below + cardH <= vp.h - EDGE ? below : above >= EDGE ? above : Math.max(EDGE, vp.h - cardH - EDGE);
    const center = hole.left + hole.width / 2 - cardW / 2;
    const left = Math.min(Math.max(EDGE, center), vp.w - cardW - EDGE);
    cardStyle = { width: cardW, top, left };
  }

  const motion = "transition-[top,left,width,height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

  return (
    <div className="fixed inset-0 z-[70] print:hidden" data-keep-selection>
      {/* 딤 + 구멍: 큰 그림자로 대상 바깥만 어둡게. 클릭은 아래 화면으로 넘기지 않음 */}
      {hole ? (
        <div
          aria-hidden
          className={cn("pointer-events-none fixed rounded-[8px] ring-2 ring-apple-blue ring-offset-2 ring-offset-white/70", motion)}
          style={{ ...hole, boxShadow: "0 0 0 9999px rgb(17 24 39 / 0.55)" }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-[rgb(17_24_39/0.55)]" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="oe-tour-title"
        aria-describedby="oe-tour-body"
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn("fixed rounded-[8px] border border-white/60 bg-white p-4 shadow-2xl outline-none", motion)}
        style={cardStyle}
      >
        <div className="flex items-start gap-3">
          <h2 id="oe-tour-title" className="min-w-0 flex-1 text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {step.title}
          </h2>
          <button
            type="button"
            onClick={finish}
            aria-label="튜토리얼 건너뛰기"
            className="-mr-1.5 -mt-1 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-ink-2 hover:bg-black/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/50"
          >
            건너뛰기
            <X className="size-3.5" />
          </button>
        </div>
        <p id="oe-tour-body" className="mt-2 break-keep text-sm leading-relaxed text-ink-2">
          {step.body}
        </p>

        {/* 진행: 지나온 단계는 채워진 막대 */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex flex-1 gap-1" aria-hidden>
            {steps.map((_, i) => (
              <span key={i} className={cn("h-1 flex-1 rounded-full", i <= index ? "bg-apple-blue" : "bg-black/10")} />
            ))}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <GlassButton onClick={prev} disabled={index === 0} className="h-8 rounded-[8px] px-3">
              이전
            </GlassButton>
            <GlassButton variant="primary" onClick={next} className="h-8 rounded-[8px] px-3 tabular-nums">
              {last ? "시작하기" : "다음"} ({index + 1}/{steps.length})
            </GlassButton>
          </div>
        </div>
      </div>
    </div>
  );
}
