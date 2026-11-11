"use client";

import { useEffect, useRef, useState } from "react";
import { Code2, Columns2, Eye, Loader2, NotebookPen, PencilLine } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCockpit } from "@/store/cockpit";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { formatLong } from "@/lib/date";
import { formatCombo } from "@/hooks/useHotkeys";
import { cn } from "@/lib/cn";
import { GlassPanel, Kbd } from "@/components/ui/Glass";
import { Markdown } from "./Markdown";
import { LiveNoteEditor, type LiveNoteEditorHandle } from "./LiveNoteEditor";

export const DAILY_NOTE_INPUT_ID = "cockpit-daily-note";
export const FOCUS_NOTE_EVENT = "cockpit:focus-note";

/** live = 서식 편집(기본, 기호 숨김) · write = 마크다운 원문 · split = 원문+미리보기 · preview = 읽기 */
type Mode = "live" | "write" | "split" | "preview";

/** 주요사항 · 회고 2개 섹션. 빈 항목에는 섹션별 안내 문구가 표시됨 (LiveNoteEditor) */
const TEMPLATE = `## 주요사항
- 

## 회고
- 잘한 점: 
- 개선점: `;

export function DailyNote({ userId, className }: { userId: string; className?: string }) {
  const selectedDate = useCockpit((s) => s.selectedDate);
  // 날짜별로 다시 마운트 → 이전 날짜의 미저장 내용은 언마운트 시 flush
  return <NoteBody key={selectedDate} date={selectedDate} userId={userId} className={className} />;
}

function NoteBody({ date, userId, className }: { date: string; userId: string; className?: string }) {
  const combo = useCockpit((s) => s.shortcuts.focusNote);
  const bumpRev = useCockpit((s) => s.bumpRev);
  const [mode, setMode] = useState<Mode>("live");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const liveRef = useRef<LiveNoteEditorHandle>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("daily_notes")
      .select("content, updated_at")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setStatus("error");
        setContent(data?.content ?? "");
        setUpdatedAt(data?.updated_at ?? null);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [date, userId]);

  // Alt+M: 미리보기 모드면 서식 편집으로 전환 후 마지막 줄 끝에 포커스
  useEffect(() => {
    const onFocus = () => {
      setMode((m) => (m === "preview" ? "live" : m));
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.focus();
        else liveRef.current?.focusEnd();
      });
    };
    window.addEventListener(FOCUS_NOTE_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_NOTE_EVENT, onFocus);
  }, []);

  const saver = useDebouncedCallback(async (text: string) => {
    setStatus("saving");
    const { data, error } = await createClient()
      .from("daily_notes")
      .upsert({ user_id: userId, date, content: text }, { onConflict: "user_id,date" })
      .select("updated_at")
      .single();
    setStatus(error ? "error" : "saved");
    if (!error) bumpRev();
    if (data) setUpdatedAt(data.updated_at);
  }, 700);

  function change(text: string) {
    setContent(text);
    saver.call(text);
  }

  /** 템플릿 삽입 후 첫 항목(주요사항)에 바로 입력할 수 있게 포커스 */
  function insertTemplate(target: "live" | "write") {
    change(TEMPLATE);
    saver.flush();
    requestAnimationFrame(() => {
      if (target === "live") {
        document.querySelector<HTMLTextAreaElement>(`[data-note-live] textarea[aria-label="목록 항목"]`)?.focus();
      } else {
        taRef.current?.focus();
      }
    });
  }

  function toggleTask(lineIndex: number) {
    const lines = content.split("\n");
    lines[lineIndex] = lines[lineIndex].replace(/\[([ xX])\]/, (_, c: string) => (c === " " ? "[x]" : "[ ]"));
    change(lines.join("\n"));
    saver.flush();
  }

  // Tab 들여쓰기, 목록에서 Enter 시 다음 항목 자동 생성
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: end, value } = ta;
    if (e.key === "Tab") {
      e.preventDefault();
      const next = value.slice(0, s) + "  " + value.slice(end);
      change(next);
      requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2));
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const line = value.slice(lineStart, s);
      const m = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[4].trim()) {
        // 빈 항목에서 Enter → 목록 종료
        const next = value.slice(0, lineStart) + value.slice(s);
        change(next);
        requestAnimationFrame(() => ta.setSelectionRange(lineStart, lineStart));
        return;
      }
      const bullet = /\d/.test(m[2]) ? `${parseInt(m[2]) + 1}${m[2].slice(-1)}` : m[2];
      const insert = `\n${m[1]}${bullet} ${m[3] ? "[ ] " : ""}`;
      const next = value.slice(0, s) + insert + value.slice(end);
      change(next);
      requestAnimationFrame(() => ta.setSelectionRange(s + insert.length, s + insert.length));
    } else if (e.key === "Escape") {
      ta.blur();
    }
  }

  const stats = content.trim() ? content.trim().split(/\s+/).length : 0;
  const tasks = content.match(/\[[ xX]\]/g) ?? [];
  const tasksDone = tasks.filter((t) => t !== "[ ]").length;

  return (
    <GlassPanel className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden print:hidden", className)}>
      <div className="flex items-center gap-3 border-b border-black/5 px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-apple-mint/15">
          <NotebookPen className="size-[18px] text-[#00a29b]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">Daily Memopad</h2>
          <p className="truncate text-xs text-ink-2">{formatLong(date)}</p>
        </div>
        <div className="flex shrink-0 rounded-lg bg-black/5 p-0.5" role="tablist" aria-label="보기 모드">
          {(
            [
              ["live", PencilLine, "작성 (서식)"],
              ["write", Code2, "마크다운 원문"],
              ["split", Columns2, "분할"],
              ["preview", Eye, "미리보기"],
            ] as const
          ).map(([m, Icon, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              aria-label={label}
              title={label}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md p-1.5 transition-[background-color,color,box-shadow]",
                mode === m ? "bg-white text-apple-blue shadow-sm" : "text-ink-2 hover:text-ink",
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </div>

      <div className={cn("grid min-h-0 flex-1", mode === "split" ? "grid-rows-2" : "grid-rows-1")}>
        {mode === "live" && (
          <div className="relative min-h-0">
            <LiveNoteEditor ref={liveRef} value={content} onChange={change} onBlur={saver.flush} disabled={!loaded} />
            {loaded && !content && <TemplateButton onClick={() => insertTemplate("live")} />}
          </div>
        )}
        {(mode === "write" || mode === "split") && (
          <div className="relative min-h-0">
            <textarea
              id={DAILY_NOTE_INPUT_ID}
              ref={taRef}
              value={content}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={saver.flush}
              disabled={!loaded}
              spellCheck={false}
              placeholder={loaded ? "오늘의 기록을 마크다운으로 남겨보세요…" : "불러오는 중…"}
              className="h-full w-full resize-none break-keep bg-transparent px-4 py-4 font-sans text-[14px] leading-[1.7] outline-none placeholder:text-ink-2/70 sm:px-5 scroll-thin"
            />
            {loaded && !content && <TemplateButton onClick={() => insertTemplate("write")} />}
          </div>
        )}
        {(mode === "split" || mode === "preview") && (
          <div className={cn("min-h-0 min-w-0 overflow-y-auto break-keep px-4 py-3 sm:px-5 scroll-thin", mode === "split" && "border-t border-black/5 bg-white/30")}>
            {content.trim() ? (
              <Markdown source={content} onToggleTask={toggleTask} />
            ) : (
              <p className="pt-2 text-sm text-ink-2">미리볼 내용이 없습니다.</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 whitespace-nowrap border-t border-black/5 px-4 py-2.5 text-[11px] text-ink-2 sm:px-5">
        <span className="shrink-0 tabular-nums">{stats}단어</span>
        {tasks.length > 0 && (
          <span className="shrink-0 tabular-nums">
            체크 {tasksDone}/{tasks.length}
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1 truncate">
          {status === "saving" && <Loader2 className="size-3 shrink-0 animate-spin" />}
          {status === "saving"
            ? "저장 중…"
            : status === "error"
              ? <span className="text-[#c4271d]">저장 실패</span>
              : updatedAt
                ? `저장됨 ${new Date(updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
        </span>
        <span className="ml-auto hidden shrink-0 items-center gap-1 sm:flex">
          포커스
          {formatCombo(combo).map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      </div>
    </GlassPanel>
  );
}

function TemplateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute left-5 top-14 rounded-lg bg-apple-blue/10 px-2.5 py-1 text-xs font-medium text-apple-blue hover:bg-apple-blue/15"
      title="주요사항 · 회고 템플릿"
    >
      템플릿으로 시작하기 (주요사항 · 회고)
    </button>
  );
}
