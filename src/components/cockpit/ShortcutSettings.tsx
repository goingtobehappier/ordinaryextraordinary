"use client";

import { useEffect, useState } from "react";
import { Keyboard, RotateCcw, X } from "lucide-react";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_META,
  useCockpit,
  type ShortcutAction,
} from "@/store/cockpit";
import { comboFromEvent, formatCombo, isBindableCombo } from "@/hooks/useHotkeys";
import { cn } from "@/lib/cn";
import { GlassButton, Kbd } from "@/components/ui/Glass";

export function ShortcutSettings() {
  const shortcuts = useCockpit((s) => s.shortcuts);
  const setShortcut = useCockpit((s) => s.setShortcut);
  const resetShortcuts = useCockpit((s) => s.resetShortcuts);
  const setOpen = useCockpit((s) => s.setShortcutsOpen);

  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!recording) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        setMessage(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // 수정자 키만 누름 → 계속 대기
      if (!isBindableCombo(combo)) {
        setMessage("Esc · Enter · Tab · Space · Backspace · Delete는 단독으로 쓸 수 없어요. 수정자 키와 함께 눌러주세요.");
        return;
      }
      const conflict = (Object.keys(shortcuts) as ShortcutAction[]).find(
        (a) => a !== recording && shortcuts[a] === combo,
      );
      if (conflict) {
        setMessage(`‘${SHORTCUT_META[conflict]}’에서 이미 사용 중인 조합입니다.`);
        return;
      }
      setShortcut(recording, combo);
      setRecording(null);
      setMessage(null);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [recording, shortcuts, setShortcut, setOpen]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/15 backdrop-blur-sm print:hidden"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-title"
        className="max-h-[90dvh] w-[min(520px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-white/40 bg-white/80 p-4 shadow-2xl backdrop-blur-2xl sm:p-6 scroll-thin"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-apple-blue/10">
            <Keyboard className="size-5 text-apple-blue" />
          </div>
          <div>
            <h2 id="shortcut-title" className="text-[17px] font-semibold">
              단축키 설정
            </h2>
            <p className="text-xs text-ink-2">항목을 클릭한 뒤 새 키(조합)를 누르세요. Esc로 취소. 단일 키는 입력창 밖에서만 동작해요.</p>
          </div>
          <GlassButton className="ml-auto px-2" onClick={() => setOpen(false)} aria-label="닫기">
            <X className="size-4" />
          </GlassButton>
        </div>

        <ul className="divide-y divide-black/5 overflow-hidden rounded-xl border border-black/5 bg-white/60">
          {(Object.keys(SHORTCUT_META) as ShortcutAction[]).map((action) => {
            const isRec = recording === action;
            const isDefault = shortcuts[action] === DEFAULT_SHORTCUTS[action];
            return (
              <li key={action} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 text-sm">{SHORTCUT_META[action]}</span>
                {!isDefault && !isRec && (
                  <button
                    className="text-[11px] text-ink-2 hover:text-apple-blue"
                    onClick={() => setShortcut(action, DEFAULT_SHORTCUTS[action])}
                  >
                    기본값
                  </button>
                )}
                <button
                  onClick={() => {
                    setRecording(isRec ? null : action);
                    setMessage(null);
                  }}
                  className={cn(
                    "flex min-w-[132px] items-center justify-end gap-1 rounded-lg px-2 py-1 transition-colors",
                    isRec ? "bg-apple-blue/10 ring-2 ring-apple-blue/50" : "hover:bg-black/5",
                  )}
                >
                  {isRec ? (
                    <span className="animate-pulse text-xs font-medium text-apple-blue">키 입력 대기…</span>
                  ) : (
                    formatCombo(shortcuts[action]).map((k) => <Kbd key={k}>{k}</Kbd>)
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex min-h-8 items-center justify-between gap-3">
          <p className={cn("text-xs", message ? "text-[#c4271d]" : "text-ink-2")}>
            {message ?? "설정은 이 브라우저에 저장됩니다."}
          </p>
          <GlassButton onClick={resetShortcuts}>
            <RotateCcw className="size-3.5" />
            전체 초기화
          </GlassButton>
        </div>
      </div>
    </div>
  );
}
