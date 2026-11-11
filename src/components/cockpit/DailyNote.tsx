"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudCheck, CloudOff, Code2, Eraser, Columns2, Eye, LayoutTemplate, Loader2, NotebookPen, PencilLine, TriangleAlert, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCockpit } from "@/store/cockpit";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { formatLong } from "@/lib/date";
import { formatCombo } from "@/hooks/useHotkeys";
import { cn } from "@/lib/cn";
import { GlassPanel, Kbd } from "@/components/ui/Glass";
import { Markdown } from "./Markdown";
import { LiveNoteEditor, type LiveNoteEditorHandle } from "./LiveNoteEditor";
import { describeNoteError, loadNote, saveNote, type DbError } from "@/lib/dailyNotes";
import { applySyntax, NOTE_SYNTAX_HINTS, type NoteSyntax } from "@/lib/noteSyntax";
import { clearDraft, clearDraftIf, readDraft, readUndo, writeDraft, writeUndo, type NoteUndo } from "@/lib/noteDraft";
import { NOTE_REMOTE_EVENT, RESYNC_EVENT, type RemoteNote } from "@/hooks/useRealtimeSync";

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

/**
 * 저장 상태 (실제 저장 위치 기준으로만 표시)
 *  pending: 입력 후 저장 대기 · saving: 서버 저장 중 · saved: 서버 저장 완료
 *  local  : 서버 실패, 이 기기(localStorage)에 임시 보관 → 동기화 대기
 *  offline: 서버에서 불러오지 못함 (아직 보관할 변경 없음)
 *  failed : 서버·이 기기 모두 저장 실패 (메모리에만 있음)
 */
/** 되돌리기 버튼 문구 (백업 사유별) */
const UNDO_COPY: Record<NoteUndo["reason"], { label: string; title: string }> = {
  template: { label: "템플릿 원복", title: "템플릿 적용 전 내용으로 되돌리기" },
  clear: { label: "초기화 취소", title: "초기화 전 내용으로 되돌리기" },
  conflict: { label: "이 기기 내용 복구", title: "다른 곳의 변경에 밀려난 이 기기 작성 내용으로 되돌리기" },
};

type SaveStatus = "idle" | "pending" | "saving" | "saved" | "local" | "offline" | "failed";

/** 서버 저장 실패 시 재시도 간격 */
const RETRY_MS = 20_000;

function NoteBody({ date, userId, className }: { date: string; userId: string; className?: string }) {
  const combo = useCockpit((s) => s.shortcuts.focusNote);
  const bumpRev = useCockpit((s) => s.bumpRev);
  const [mode, setMode] = useState<Mode>("live");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  /** 마지막 서버 동기화 실패 원인 (상태 툴팁에 표시) */
  const [syncError, setSyncError] = useState<string | null>(null);
  /** 템플릿 적용 직전 내용 (또는 서버와 충돌해 밀려난 이 기기 내용) */
  const [undo, setUndo] = useState<NoteUndo | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const liveRef = useRef<LiveNoteEditorHandle>(null);
  /** 원복·초기화 시 서식 편집기를 새로 마운트하기 위한 키 */
  const [editorRev, setEditorRev] = useState(0);
  /** 서버의 현재 버전을 알고 있는지. 모르면(불러오기 실패) 서버에 쓰지 않고 이 기기에만 저장 */
  const serverKnown = useRef(false);
  /** 마지막으로 확인한 서버 버전 (draft.base와 비교해 덮어쓰기 충돌 판단) */
  const serverVersion = useRef<string | null>(null);
  const latest = useRef("");
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 언마운트 후에는 재시도를 예약하지 않음 (draft는 남아 다음에 이 날짜를 열 때 동기화) */
  const mounted = useRef(true);
  /** 서버에 아직 반영되지 않은 변경이 있는지 */
  const dirty = useRef(false);
  /** 마지막 이 기기 보관(localStorage) 성공 여부 */
  const localOk = useRef(true);

  /** 서버 내용과 이 기기 draft를 맞춤. 서버를 덮어써도 안전한 경우에만 draft를 올림 */
  const reconcile = useCallback(
    (server: { content: string | null; updated_at: string | null } | null) => {
      const draft = readDraft(userId, date);
      const serverContent = server?.content ?? "";
      serverKnown.current = true;
      serverVersion.current = server?.updated_at ?? null;
      setUpdatedAt(server?.updated_at ?? null);

      if (!draft || draft.content === serverContent) {
        if (draft) clearDraft(userId, date);
        return { content: serverContent, push: false };
      }
      // draft가 지금 서버 버전을 기반으로 했거나, 서버가 비어 있으면 draft가 최신
      if (!serverContent.trim() || draft.base === (server?.updated_at ?? null)) {
        return { content: draft.content, push: true };
      }
      // 다른 곳에서 서버가 바뀜 → 서버 내용을 쓰고, 이 기기 내용은 되돌리기로 보관 (유실 없음)
      const conflict: NoteUndo = { content: draft.content, reason: "conflict", at: Date.now() };
      writeUndo(userId, date, conflict);
      setUndo(conflict);
      clearDraft(userId, date);
      return { content: serverContent, push: false };
    },
    [userId, date],
  );

  /** 서버 조회 (레거시 스키마·세션 만료 자동 대응은 lib/dailyNotes) */
  const fetchServer = useCallback(
    () =>
      loadNote(createClient(), userId, date).then((r) =>
        r.ok ? { data: r.data, error: null } : { data: null, error: r.error },
      ),
    [userId, date],
  );

  function fallBack(error: DbError) {
    setSyncError(describeNoteError(error));
    const where = !dirty.current ? "offline" : localOk.current ? "local" : "failed";
    console.warn(`[memopad] 서버 저장 실패 → ${where === "failed" ? "이 기기 보관도 실패" : "이 기기에 임시 보관"}, 자동 재시도 예정`, {
      date,
      code: error.code,
      message: error.message,
    });
    setStatus(where);
    if (mounted.current) retryTimer.current = setTimeout(() => void pushRef.current(latest.current), RETRY_MS);
  }

  /** 서버 저장. 실패하면 이 기기에 저장하고 잠시 뒤 자동 재시도 (저장 실패 대신 '이 기기에 저장됨') */
  async function push(text: string) {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (dirty.current) localOk.current = writeDraft(userId, date, text, serverVersion.current);

    if (!serverKnown.current) {
      // 서버 버전을 아직 모름 → 다시 불러와 맞춘 뒤 저장
      const { data, error } = await fetchServer();
      if (error) return fallBack(error);
      const { content: next, push: needPush } = reconcile(data);
      if (next !== latest.current) {
        latest.current = next;
        setContent(next);
      }
      if (!needPush) {
        // 서버와 일치 (올릴 변경 없음)
        if (!dirty.current || latest.current === next) {
          dirty.current = false;
          setSyncError(null);
          setStatus("saved");
        }
        return;
      }
      text = next;
    }

    setStatus("saving");
    const res = await saveNote(createClient(), userId, date, text);
    if (!res.ok) return fallBack(res.error);
    clearDraftIf(userId, date, text);
    serverVersion.current = res.data.updated_at;
    // updated_at 컬럼이 없는 레거시 테이블이면 저장 시각을 표시
    setUpdatedAt(res.data.updated_at ?? new Date().toISOString());
    bumpRev();
    // 요청 중에 더 입력했다면 아직 '저장됨'이 아님 (곧 다음 저장이 이어짐)
    setSyncError(null);
    if (text === latest.current) {
      dirty.current = false;
      setStatus("saved");
    } else {
      setStatus("pending");
    }
  }
  const pushRef = useRef(push);
  useEffect(() => {
    pushRef.current = push;
  });

  useEffect(() => {
    let cancelled = false;
    void fetchServer().then(({ data, error }) => {
      if (cancelled) return;
      setUndo(readUndo(userId, date));
      if (error) {
        // 서버를 못 읽음 → 이 기기 draft로 이어 쓰고, 서버에는 확인될 때까지 쓰지 않음
        console.warn("[memopad] 불러오기 실패, 이 기기 사본 사용", { date, code: error.code, message: error.message });
        setSyncError(describeNoteError(error));
        const draft = readDraft(userId, date);
        latest.current = draft?.content ?? "";
        dirty.current = !!draft;
        setContent(latest.current);
        setStatus(draft ? "local" : "offline");
        setLoaded(true);
        retryTimer.current = setTimeout(() => void pushRef.current(latest.current), RETRY_MS);
        return;
      }
      const { content: next, push: needPush } = reconcile(data);
      latest.current = next;
      setContent(next);
      setLoaded(true);
      if (needPush) {
        dirty.current = true;
        void pushRef.current(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [date, userId, fetchServer, reconcile]);

  // 네트워크가 돌아오면 바로 재시도, 언마운트 시 타이머 정리
  useEffect(() => {
    const onOnline = () => {
      if (dirty.current || !serverKnown.current) void pushRef.current(latest.current);
    };
    mounted.current = true;
    window.addEventListener("online", onOnline);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", onOnline);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [userId, date]);

  useEffect(() => {
    if (status !== "failed") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

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

  const saver = useDebouncedCallback((text: string) => void push(text), 700);
  const saverPending = saver.isPending;

  // Realtime: 다른 기기에서 바뀐 메모 반영. 이 기기에 아직 저장 안 된 입력이 있으면 덮어쓰지 않음
  // (곧 이 기기 내용이 저장되며 마지막 저장이 우선)
  useEffect(() => {
    if (!loaded) return;
    const apply = (remote: { content: string; updated_at: string | null }) => {
      if (dirty.current || saverPending()) return;
      if (remote.updated_at && remote.updated_at === serverVersion.current) return; // 이 기기 저장의 메아리
      serverKnown.current = true;
      serverVersion.current = remote.updated_at;
      setUpdatedAt(remote.updated_at);
      if (remote.content !== latest.current) {
        latest.current = remote.content;
        setContent(remote.content);
      }
    };
    const onRemote = (e: Event) => {
      const d = (e as CustomEvent<RemoteNote>).detail;
      if (d.date === date) apply(d);
    };
    const onResync = () => {
      if (dirty.current || saverPending()) return;
      void fetchServer().then(({ data, error }) => {
        if (!error && data) apply(data);
      });
    };
    window.addEventListener(NOTE_REMOTE_EVENT, onRemote);
    window.addEventListener(RESYNC_EVENT, onResync);
    return () => {
      window.removeEventListener(NOTE_REMOTE_EVENT, onRemote);
      window.removeEventListener(RESYNC_EVENT, onResync);
    };
  }, [loaded, date, fetchServer, saverPending]);

  function change(text: string) {
    latest.current = text;
    dirty.current = true;
    setContent(text);
    // 입력 즉시 이 기기에 보관 → 탭이 닫히거나 저장 전 오류가 나도 유실 없음
    localOk.current = writeDraft(userId, date, text, serverVersion.current);
    // 서버 반영 전까지는 '저장됨'을 유지하지 않음 (이전 실패 상태는 재시도 결과로 갱신)
    setStatus((s) => (s === "local" || s === "failed" || s === "offline" ? s : "pending"));
    saver.call(text);
  }

  function focusAfterTemplate(target: Mode) {
    requestAnimationFrame(() => {
      if (target === "live") {
        document.querySelector<HTMLTextAreaElement>(`[data-note-live] textarea[aria-label="목록 항목"]`)?.focus();
      } else {
        taRef.current?.focus();
      }
    });
  }

  /** 템플릿 적용: 작성 중이던 내용이 있으면 되돌리기용으로 백업 후 교체 */
  function applyTemplate() {
    if (!loaded || content === TEMPLATE) return;
    // 빈 메모였어도 백업 → 원복하면 서식 없는 빈 본문으로 정확히 돌아감
    backupBeforeReplace("template");
    const target = mode === "preview" ? "live" : mode;
    if (target !== mode) setMode(target);
    change(TEMPLATE);
    saver.flush();
    focusAfterTemplate(target);
  }

  function backupBeforeReplace(reason: NoteUndo["reason"]) {
    const backup: NoteUndo = { content, reason, at: Date.now() };
    writeUndo(userId, date, backup);
    setUndo(backup);
  }

  /**
   * 내용을 통째로 바꿀 때(원복·초기화): 서식 편집기를 새로 마운트해
   * 포커스 줄·커서·줄 높이 등 이전 블록 상태가 남지 않게 하고 첫 줄에 포커스
   */
  function replaceContent(next: string) {
    change(next);
    saver.flush();
    setEditorRev((r) => r + 1);
    requestAnimationFrame(() => {
      if (mode === "write" || mode === "split") taRef.current?.focus();
      else document.querySelector<HTMLTextAreaElement>("[data-note-live] textarea")?.focus();
    });
  }

  /** 백업한 내용으로 되돌림 (템플릿 적용 전 빈 메모였다면 서식 없는 빈 본문) */
  function restoreUndo() {
    if (!undo) return;
    writeUndo(userId, date, null);
    setUndo(null);
    replaceContent(undo.content);
  }

  /** 초기화: 내용과 블록 서식을 모두 지우고 일반 본문으로 (되돌리기 가능) */
  function clearNote() {
    if (!loaded || !content) return;
    backupBeforeReplace("clear");
    replaceContent("");
  }

  /** 하단 서식 힌트 클릭 → 에디터 커서 위치에 마크다운 문법 적용 */
  function insertSyntax(kind: NoteSyntax) {
    if (!loaded) return;
    if (mode === "preview") {
      setMode("live");
      requestAnimationFrame(() => liveRef.current?.insertSyntax(kind));
      return;
    }
    if (mode === "live") {
      liveRef.current?.insertSyntax(kind);
      return;
    }
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    let next: string;
    let caret: number;
    if (kind === "bold") {
      ({ text: next, caret } = applySyntax(value, s, e, kind));
    } else {
      // 블록 문법은 커서가 있는 줄에 적용
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const nl = value.indexOf("\n", s);
      const lineEnd = nl < 0 ? value.length : nl;
      const out = applySyntax(value.slice(lineStart, lineEnd), s - lineStart, s - lineStart, kind);
      next = value.slice(0, lineStart) + out.text + value.slice(lineEnd);
      caret = lineStart + out.caret;
    }
    change(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
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
        {undo && (
          <button
            onClick={restoreUndo}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-apple-blue/10 px-2 py-1.5 text-xs font-medium text-apple-blue transition-colors hover:bg-apple-blue/15"
            title={UNDO_COPY[undo.reason].title}
          >
            <Undo2 className="size-3.5" />
            <span className="hidden sm:inline">{UNDO_COPY[undo.reason].label}</span>
          </button>
        )}
        <button
          onClick={clearNote}
          disabled={!loaded || !content}
          className="shrink-0 rounded-lg p-1.5 text-ink-2 transition-colors hover:bg-black/5 hover:text-ink disabled:opacity-40"
          title="초기화: 내용과 제목·목록 서식을 모두 지우고 일반 본문으로 (되돌리기 가능)"
          aria-label="메모 초기화"
        >
          <Eraser className="size-4" />
        </button>
        <button
          onClick={applyTemplate}
          disabled={!loaded}
          className="shrink-0 rounded-lg p-1.5 text-ink-2 transition-colors hover:bg-black/5 hover:text-ink disabled:opacity-40"
          title="주요사항 · 회고 템플릿 적용 (작성 중인 내용은 원복 가능)"
          aria-label="템플릿 적용"
        >
          <LayoutTemplate className="size-4" />
        </button>
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
            <LiveNoteEditor key={editorRev} ref={liveRef} value={content} onChange={change} onBlur={saver.flush} disabled={!loaded} />
            {loaded && !content && <TemplateButton onClick={applyTemplate} />}
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
            {loaded && !content && <TemplateButton onClick={applyTemplate} />}
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

      <SyntaxHints onInsert={insertSyntax} disabled={!loaded} />
      <div className="flex items-center gap-3 whitespace-nowrap border-t border-black/5 px-4 py-2.5 text-[11px] text-ink-2 sm:px-5">
        <span className="shrink-0 tabular-nums">{stats}단어</span>
        {tasks.length > 0 && (
          <span className="shrink-0 tabular-nums">
            체크 {tasksDone}/{tasks.length}
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1 truncate">
          <SaveIndicator status={status} updatedAt={updatedAt} reason={syncError} />
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

/** 미니 마크다운 서식 힌트: 평소엔 은은하게, 클릭하면 커서 위치에 문법 입력 */
function SyntaxHints({ onInsert, disabled }: { onInsert: (kind: NoteSyntax) => void; disabled?: boolean }) {
  return (
    <div
      className="flex items-center overflow-hidden whitespace-nowrap px-3 pb-1 pt-0.5 font-mono text-[11px] text-ink-2/50 sm:px-4"
      aria-label="마크다운 서식 입력"
    >
      {NOTE_SYNTAX_HINTS.map(({ kind, label, title }, i) => (
        <span key={kind} className="flex shrink-0 items-center">
          {i > 0 && <span className="select-none px-0.5 text-ink-2/25" aria-hidden>|</span>}
          <button
            type="button"
            // 에디터 포커스·커서를 유지한 채 삽입
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(kind)}
            disabled={disabled}
            title={title}
            className="rounded px-1 py-0.5 transition-colors hover:bg-black/[0.04] hover:text-ink-2 disabled:pointer-events-none"
          >
            {label}
          </button>
        </span>
      ))}
    </div>
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

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

/** 저장 위치·동기화 여부를 그대로 보여 주는 상태 표시 */
function SaveIndicator({ status, updatedAt, reason }: { status: SaveStatus; updatedAt: string | null; reason?: string | null }) {
  const why = reason ? `\n원인: ${reason}` : "";
  switch (status) {
    case "pending":
    case "saving":
      return (
        <span className="flex items-center gap-1">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          저장 중…
        </span>
      );
    case "local":
      return (
        <span
          className="flex min-w-0 items-center gap-1 text-[#b86b00]"
          title={`서버에 저장하지 못해 이 기기(브라우저)에 임시 보관했습니다. 연결되면 자동으로 서버에 동기화됩니다.${why}`}
        >
          <CloudOff className="size-3 shrink-0" />
          <span className="truncate">이 기기에 임시 저장됨 · 동기화 대기</span>
        </span>
      );
    case "offline":
      return (
        <span className="flex min-w-0 items-center gap-1 text-[#b86b00]" title={`서버에서 메모를 불러오지 못했습니다. 자동으로 다시 연결합니다.${why}`}>
          <CloudOff className="size-3 shrink-0" />
          <span className="truncate">서버 연결 대기 중</span>
        </span>
      );
    case "failed":
      return (
        <span
          className="flex min-w-0 items-center gap-1 font-medium text-[#c4271d]"
          title={`서버와 이 기기 모두 저장하지 못했습니다. 페이지를 닫으면 내용이 사라질 수 있으니 내용을 복사해 두세요. 자동으로 다시 시도합니다.${why}`}
          role="alert"
        >
          <TriangleAlert className="size-3 shrink-0" />
          <span className="truncate">저장 실패 · 재시도 중</span>
        </span>
      );
    case "saved":
      return (
        <span className="flex items-center gap-1" title="서버에 저장 완료">
          <CloudCheck className="size-3 shrink-0 text-[#00a29b]" />
          {updatedAt ? `저장됨 ${fmtTime(updatedAt)}` : "저장됨"}
        </span>
      );
    default:
      return updatedAt ? <span title="서버에 저장된 마지막 시각">마지막 저장 {fmtTime(updatedAt)}</span> : null;
  }
}
