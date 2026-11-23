"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, Mic, RotateCcw, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatLong, todayISO } from "@/lib/date";
import { BrandMark } from "@/components/ui/Brand";
import { ASSISTANT_NAME, QUICK_PROMPTS, useAssistant } from "@/store/assistant";

/** 모델 답변의 마크다운 강조·제목 기호를 걷어내고 목록 기호만 정리 (본문은 pre-wrap으로 표시) */
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^(\s*)[*-]\s+/gm, "$1• ");
}

// ───────────────────────────── 음성 입력 (Web Speech API) ─────────────────────────────

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};
type RecognitionCtor = new () => RecognitionLike;

function getRecognition(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 말한 내용을 입력창에 받아 적음 (자동 전송하지 않음 — 확인 후 보내기) */
function useVoiceInput(onText: (text: string) => void) {
  const [supported] = useState(() => getRecognition() !== null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<RecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => () => recRef.current?.stop(), []);

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "ko-KR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onTextRef.current(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  return { supported, listening, toggle };
}

// ───────────────────────────── 대화창 ─────────────────────────────

/**
 * O.E. Manager 대화창.
 * panel  = PC: 우측 메모 패널 자리를 같은 크기로 교체
 * screen = 모바일: O.E. Manager 탭 전체 화면
 */
export function AssistantChat({ variant, className }: { variant: "panel" | "screen"; className?: string }) {
  const messages = useAssistant((s) => s.messages);
  const input = useAssistant((s) => s.input);
  const pending = useAssistant((s) => s.pending);
  const setInput = useAssistant((s) => s.setInput);
  const send = useAssistant((s) => s.send);
  const reset = useAssistant((s) => s.reset);
  const setOpen = useAssistant((s) => s.setOpen);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const screen = variant === "screen";

  // 음성 입력: 시작 시점의 입력값 뒤에 받아 적음
  const baseRef = useRef("");
  const voice = useVoiceInput((text) => setInput([baseRef.current, text].filter(Boolean).join(" ")));

  // PC 패널은 열리면 바로 입력 (모바일은 키보드가 화면을 가리지 않도록 자동 포커스하지 않음)
  useEffect(() => {
    if (!screen) inputRef.current?.focus();
  }, [screen]);

  // 새 메시지·로딩 표시가 생기면 맨 아래로
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const submit = (text: string) => {
    if (voice.listening) voice.toggle();
    void send(text);
    if (!screen) inputRef.current?.focus();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(input);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // PC: Esc → 원래 메모 패널로
    if (!screen && e.key === "Escape" && !e.nativeEvent.isComposing) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const empty = messages.length === 0;

  return (
    <section
      aria-label={ASSISTANT_NAME}
      onKeyDown={onKeyDown}
      data-keep-selection
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden bg-white print:hidden",
        screen ? "" : "rounded-lg border border-black/[0.08] shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
        className,
      )}
    >
      <header
        className={cn(
          "flex shrink-0 items-center gap-2.5 border-b border-black/[0.06]",
          screen ? "h-14 px-4 pt-[env(safe-area-inset-top)] box-content" : "h-12 pl-4 pr-2",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[#262626]">
          <BrandMark className="w-[18px] text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-[#262626]">{ASSISTANT_NAME}</h2>
          {screen && <p className="truncate text-[11px] text-ink-2">{formatLong(todayISO())}</p>}
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={pending || empty}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-black/5 hover:text-[#262626] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#262626]/30 disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw className="size-3.5" />
          초기화
        </button>
      </header>

      <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {empty ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-ink-2">
              일정 조회·등록, 미완료 일정 이월, 세부 메모 기록을 대화로 처리합니다.
              {voice.supported && " 마이크로 말해도 됩니다."}
            </p>
            <div className={cn("grid gap-2", screen ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
              {QUICK_PROMPTS.map((p) => (
                <QuickPrompt key={p} label={p} onClick={() => submit(p)} disabled={pending} />
              ))}
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <li key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap break-keep rounded-lg px-3 py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]",
                    m.role === "user"
                      ? "bg-[#262626] text-white"
                      : m.error
                        ? "border border-[#c4271d]/20 bg-[#c4271d]/[0.06] text-[#a8231a]"
                        : "border border-black/[0.06] bg-[#f6f6f6] text-[#262626]",
                  )}
                >
                  {m.role === "assistant" ? plain(m.content) : m.content}
                </div>
              </li>
            ))}
            {pending && (
              <li className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-lg border border-black/[0.06] bg-[#f6f6f6] px-3 py-2 text-[13px] text-ink-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  처리 중
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      {!empty && (
        <div className="scroll-thin flex shrink-0 gap-2 overflow-x-auto border-t border-black/[0.06] px-4 py-2">
          {QUICK_PROMPTS.map((p) => (
            <QuickPrompt key={p} label={p} onClick={() => submit(p)} disabled={pending} compact />
          ))}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className={cn(
          "flex shrink-0 items-end gap-2 border-t border-black/[0.06] p-3",
          // PC: 우측 하단 고정 버튼(56px)과 겹치지 않도록 오른쪽 여백
          !screen && "md:pr-[84px]",
        )}
      >
        <label htmlFor={`assistant-input-${variant}`} className="sr-only">
          메시지
        </label>
        <textarea
          id={`assistant-input-${variant}`}
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          rows={1}
          maxLength={4000}
          placeholder={voice.listening ? "듣는 중" : "일정 추가·조회를 입력하세요"}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-black/10 bg-white px-3 py-2 text-base text-[#262626] outline-none transition-[border-color,box-shadow] [field-sizing:content] placeholder:text-ink-2/70 focus:border-[#262626]/40 focus:ring-2 focus:ring-[#262626]/10 md:text-[13px] md:leading-6"
        />
        {voice.supported && (
          <button
            type="button"
            onClick={() => {
              if (!voice.listening) baseRef.current = input.trim();
              voice.toggle();
            }}
            aria-label={voice.listening ? "음성 입력 중지" : "음성으로 입력"}
            aria-pressed={voice.listening}
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#262626]/30",
              voice.listening
                ? "border-[#c4271d]/30 bg-[#c4271d]/[0.08] text-[#c4271d]"
                : "border-black/10 bg-white text-ink-2 hover:text-[#262626]",
            )}
          >
            {voice.listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
          </button>
        )}
        <button
          type="submit"
          disabled={pending || !input.trim()}
          aria-label="보내기"
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[#262626] text-white transition-[background-color,transform] hover:bg-black active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#262626]/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-30"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </form>
    </section>
  );
}

function QuickPrompt({
  label,
  onClick,
  disabled,
  compact,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md border border-black/10 bg-white text-[#262626] transition-colors hover:border-[#262626]/30 hover:bg-[#f6f6f6]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#262626]/30 disabled:pointer-events-none disabled:opacity-40",
        compact ? "h-8 shrink-0 whitespace-nowrap px-3 text-xs" : "min-h-11 px-3 py-2.5 text-left text-[13px]",
      )}
    >
      {label}
    </button>
  );
}
