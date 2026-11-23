"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, MessageSquareText, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { useCockpit } from "@/store/cockpit";
import { DETAIL_RELOAD_EVENT } from "./TaskDetailPanel";

type ChatMessage = { role: "user" | "assistant"; content: string; error?: boolean };
type AssistantResponse = {
  reply?: string;
  actions?: unknown[];
  changed?: boolean;
  error?: string;
  stage?: string;
  toolErrors?: string[];
};

/** 서버가 알려준 실패 단계 → 화면 표시용 이름 */
const STAGE_LABEL: Record<string, string> = {
  config: "서버 설정",
  auth: "인증",
  request: "요청 형식",
  gemini: "Gemini API 호출",
  server: "서버 처리",
};

const QUICK_PROMPTS = [
  "오늘 일정 브리핑",
  "어제 미완료 일정 오늘로 이월해줘",
  "작년 이맘때 유사 업무 찾아줘",
  "오늘 완료한 업무 1분 회고 정리해줘",
];

/** 서버로 보내는 대화 길이 (API도 최근 20개만 사용) */
const HISTORY_LIMIT = 20;

/** 모델 답변의 마크다운 강조·제목 기호를 걷어내고 목록 기호만 정리 (본문은 pre-wrap으로 표시) */
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^(\s*)[*-]\s+/gm, "$1• ");
}

class AssistantError extends Error {
  constructor(
    message: string,
    readonly changed: boolean,
  ) {
    super(message);
  }
}

async function askAssistant(messages: ChatMessage[]): Promise<AssistantResponse> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;

  let res: Response;
  try {
    res = await fetch("/api/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages: messages
          .filter((m) => !m.error)
          .slice(-HISTORY_LIMIT)
          .map(({ role, content }) => ({ role, content })),
      }),
    });
  } catch (e) {
    throw new AssistantError(`[네트워크] 서버에 연결하지 못했습니다. (${e instanceof Error ? e.message : String(e)})`, false);
  }

  // 실패 응답이 JSON이 아닐 수도 있음 (예: 호스팅 시간 초과 페이지)
  const text = await res.text();
  let body: AssistantResponse = {};
  try {
    body = text ? (JSON.parse(text) as AssistantResponse) : {};
  } catch {
    body = { error: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) };
  }

  if (!res.ok) {
    const stage = body.stage ? (STAGE_LABEL[body.stage] ?? body.stage) : res.status === 401 ? "인증" : "응답";
    const lines = [
      `[${stage} 실패 · HTTP ${res.status}]`,
      body.error || res.statusText || "AI 매니저 응답을 받지 못했습니다.",
      ...(body.toolErrors?.length ? ["", "DB 도구 오류:", ...body.toolErrors] : []),
    ];
    throw new AssistantError(lines.join("\n"), body.changed === true);
  }
  return body;
}

/** 우측 하단 플로팅 AI 매니저 — 일정 조회·등록·이월·회고를 대화로 처리 */
export function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 열면 입력창에 포커스
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 새 메시지·로딩 표시가 생기면 맨 아래로
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending, open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || pending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setPending(true);

    let changed = false;
    try {
      const res = await askAssistant(next);
      changed = res.changed === true;
      setMessages((m) => [...m, { role: "assistant", content: res.reply?.trim() || "응답이 비어 있습니다." }]);
    } catch (e) {
      // 오류여도 도구가 일부 실행됐을 수 있음 (서버가 changed를 함께 돌려줌)
      changed = e instanceof AssistantError && e.changed;
      const message = e instanceof Error ? e.message : "AI 매니저 응답을 받지 못했습니다.";
      setMessages((m) => [...m, { role: "assistant", content: message, error: true }]);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }

    // 일정이 추가·수정·이월됨 → 보고 있는 범위와 미완료 목록을 다시 불러와 즉시 반영
    // (회고·도구·태그는 todo에 실려 오고, 세부 메모는 열려 있는 상세 화면이 따로 다시 불러옴)
    if (changed) {
      void useCockpit
        .getState()
        .resync()
        .finally(() => window.dispatchEvent(new Event(DETAIL_RELOAD_EVENT)));
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
      e.stopPropagation();
      close();
    }
  };

  const reset = () => {
    if (pending) return;
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  };

  return (
    <div className="print:hidden" data-keep-selection>
      {open && (
        <div
          role="dialog"
          aria-label="AI 매니저"
          onKeyDown={onPanelKeyDown}
          className={cn(
            "fixed inset-x-3 bottom-[calc(80px+env(safe-area-inset-bottom))] z-40 flex h-[560px] max-h-[calc(100dvh-120px)] flex-col",
            "rounded-2xl border border-white/40 bg-white/90 shadow-2xl backdrop-blur-xl",
            "sm:inset-x-auto sm:right-5 sm:bottom-[92px] sm:w-[380px]",
          )}
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.06] pl-4 pr-2">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">AI 매니저</h2>
            <button
              type="button"
              onClick={reset}
              disabled={pending || !messages.length}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-black/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/50 disabled:pointer-events-none disabled:opacity-40"
            >
              <RotateCcw className="size-3.5" />
              초기화
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="닫기"
              className="flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-black/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/50"
            >
              <X className="size-4" />
            </button>
          </header>

          <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] leading-relaxed text-ink-2">
                  일정 조회·등록, 미완료 일정 이월, 퇴근 회고 정리를 대화로 처리합니다.
                </p>
                <div className="flex flex-col gap-2">
                  {QUICK_PROMPTS.map((p) => (
                    <QuickPrompt key={p} label={p} onClick={() => void send(p)} disabled={pending} />
                  ))}
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {messages.map((m, i) => (
                  <li key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap break-keep rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]",
                        m.role === "user"
                          ? "rounded-br-md bg-apple-blue text-white"
                          : m.error
                            ? "rounded-bl-md bg-[#ff3b30]/10 text-[#c4271d]"
                            : "rounded-bl-md bg-black/[0.05] text-ink",
                      )}
                    >
                      {m.role === "assistant" ? plain(m.content) : m.content}
                    </div>
                  </li>
                ))}
                {pending && (
                  <li className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-black/[0.05] px-3.5 py-2.5 text-[13px] text-ink-2">
                      <Loader2 className="size-3.5 animate-spin" />
                      처리 중
                    </div>
                  </li>
                )}
              </ul>
            )}
          </div>

          {messages.length > 0 && (
            <div className="scroll-thin flex shrink-0 gap-2 overflow-x-auto border-t border-black/[0.06] px-4 py-2">
              {QUICK_PROMPTS.map((p) => (
                <QuickPrompt key={p} label={p} onClick={() => void send(p)} disabled={pending} compact />
              ))}
            </div>
          )}

          <form onSubmit={onSubmit} className="flex shrink-0 items-end gap-2 border-t border-black/[0.06] p-3">
            <label htmlFor="assistant-input" className="sr-only">
              메시지
            </label>
            <textarea
              id="assistant-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKeyDown}
              rows={1}
              maxLength={4000}
              placeholder="메시지 입력"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-black/5 bg-white/70 px-3 py-2 text-base text-ink outline-none transition-[box-shadow,background-color] [field-sizing:content] placeholder:text-ink-2/70 focus:bg-white focus:ring-2 focus:ring-apple-blue/40 sm:text-[13px] sm:leading-6"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              aria-label="보내기"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-apple-blue text-white transition-[background-color,transform] hover:bg-[#0068d9] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/50 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </button>
          </form>
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={open ? "AI 매니저 닫기" : "AI 매니저 열기"}
        aria-expanded={open}
        className={cn(
          "fixed right-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 flex size-14 items-center justify-center rounded-full sm:right-5 sm:bottom-5",
          "bg-ink text-white shadow-lg shadow-black/20 transition-[background-color,transform] hover:bg-black active:scale-[0.96]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/60 focus-visible:ring-offset-2",
        )}
      >
        {open ? <X className="size-5" /> : <MessageSquareText className="size-5" />}
      </button>
    </div>
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
        "rounded-xl border border-black/[0.08] bg-white/70 text-ink transition-colors hover:border-black/15 hover:bg-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-blue/50 disabled:pointer-events-none disabled:opacity-40",
        compact ? "h-8 shrink-0 whitespace-nowrap px-3 text-xs" : "min-h-11 px-3.5 py-2.5 text-left text-[13px]",
      )}
    >
      {label}
    </button>
  );
}
