"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, CircleAlert, Link2, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { useCalendar } from "@/store/calendar";
import { parseISODate, toISODate, todayISO } from "@/lib/date";
import { cn } from "@/lib/cn";
import { GlassButton, GlassInput } from "@/components/ui/Glass";

const firstOfMonth = () => {
  const d = parseISODate(todayISO());
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** 외부 캘린더(iCal/ICS) 연동 설정 */
export function CalendarSyncModal() {
  const setOpen = useCalendar((s) => s.setModalOpen);
  const sources = useCalendar((s) => s.sources);
  const errors = useCalendar((s) => s.errors);
  const loading = useCalendar((s) => s.loading);
  const loadSources = useCalendar((s) => s.loadSources);
  const addSource = useCalendar((s) => s.addSource);
  const updateSource = useCalendar((s) => s.updateSource);
  const removeSource = useCalendar((s) => s.removeSource);
  const reload = useCalendar((s) => s.reload);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [syncStart, setSyncStart] = useState(firstOfMonth);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadSources().then((err) => err && setMessage(err));
  }, [loadSources]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    const err = await addSource({ name, url, sync_start: syncStart || firstOfMonth() });
    setBusy(false);
    if (err) {
      setMessage(err);
      return;
    }
    setName("");
    setUrl("");
  }

  async function run(p: Promise<string | null>) {
    const err = await p;
    setMessage(err);
  }

  const today = todayISO();
  const month1 = firstOfMonth();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/15 backdrop-blur-sm print:hidden"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-sync-title"
        className="max-h-[90dvh] w-[min(560px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-white/40 bg-white/85 p-4 shadow-2xl backdrop-blur-2xl sm:p-6 scroll-thin"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#8e44ad]/10">
            <CalendarPlus className="size-5 text-[#8e44ad]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="calendar-sync-title" className="text-[17px] font-semibold">
              외부 캘린더 연동
            </h2>
            <p className="text-xs text-ink-2">iCal(ICS) 주소의 일정을 주간·월간 보기에 읽기 전용으로 표시합니다.</p>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-2 hover:bg-black/5" aria-label="닫기">
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-xl border border-black/5 bg-white/60 p-3 sm:p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-2">iCal URL</span>
            <GlassInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="h-9 w-full"
              autoFocus
            />
          </label>

          <div>
            <label htmlFor="calendar-sync-start" className="mb-1 block text-xs font-medium text-ink-2">
              동기화 시작 날짜
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <GlassInput
                id="calendar-sync-start"
                type="date"
                value={syncStart}
                onChange={(e) => setSyncStart(e.target.value)}
                className="h-9 w-[160px] tabular-nums"
                required
              />
              <QuickDate label="이번 달 1일" value={month1} current={syncStart} onPick={setSyncStart} />
              <QuickDate label="오늘" value={today} current={syncStart} onPick={setSyncStart} />
            </div>
            <p className="mt-1 text-[11px] text-ink-2">이 날짜 이후의 일정만 불러옵니다. 반복 일정도 이전 회차는 제외됩니다.</p>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-2">이름 (선택)</span>
            <GlassInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 회사 캘린더"
              maxLength={60}
              className="h-9 w-full"
            />
          </label>

          <div className="flex items-center justify-end gap-2 pt-1">
            <GlassButton type="submit" variant="mint" disabled={!url.trim() || busy} className="h-9 px-4">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              연동하기
            </GlassButton>
          </div>
        </form>

        {message && (
          <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-lg bg-[#ff3b30]/[0.08] px-3 py-2 text-xs text-[#c4271d]">
            <CircleAlert className="mt-px size-3.5 shrink-0" />
            <span className="break-keep">{message}</span>
          </p>
        )}

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">연동된 캘린더 {sources.length > 0 && <span className="text-ink-2">{sources.length}</span>}</span>
            {sources.length > 0 && (
              <GlassButton onClick={() => void reload()} className="h-7 px-2 text-xs" disabled={loading}>
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
                새로고침
              </GlassButton>
            )}
          </div>
          {sources.length === 0 ? (
            <p className="rounded-lg bg-black/[0.03] px-3 py-4 text-center text-xs text-ink-2">아직 연동된 캘린더가 없습니다.</p>
          ) : (
            <ul className="space-y-1.5">
              {sources.map((s) => (
                <li key={s.id} className="rounded-lg border border-black/5 bg-white/60 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.name}</div>
                      <div className="truncate text-[11px] text-ink-2" title={s.url}>
                        {hostOf(s.url)}
                      </div>
                    </div>
                    <label className="flex shrink-0 items-center gap-1 text-[11px] text-ink-2">
                      <span className="hidden sm:inline">시작</span>
                      <input
                        type="date"
                        value={s.sync_start}
                        onChange={(e) => e.target.value && void run(updateSource(s.id, { sync_start: e.target.value }))}
                        className="rounded-md bg-black/5 px-1.5 py-1 tabular-nums text-ink outline-none focus:ring-2 focus:ring-apple-blue/30"
                        aria-label={`${s.name} 동기화 시작 날짜`}
                      />
                    </label>
                    <button
                      onClick={() => void run(removeSource(s.id))}
                      className="shrink-0 rounded-md p-1 text-ink-2 hover:bg-[#ff3b30] hover:text-white"
                      aria-label={`${s.name} 연동 해제`}
                      title="연동 해제"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {errors[s.id] && (
                    <p className="mt-1 flex items-start gap-1 text-[11px] text-[#c4271d]">
                      <CircleAlert className="mt-px size-3 shrink-0" />
                      <span className="break-keep">{errors[s.id]}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <details className="mt-4 text-xs text-ink-2">
          <summary className="cursor-pointer select-none font-medium">iCal 주소는 어디서 찾나요?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Google 캘린더: 설정 → 캘린더 선택 → 캘린더 통합 → ‘iCal 형식의 비공개 주소’</li>
            <li>Outlook: 설정 → 캘린더 → 공유 캘린더 → 캘린더 게시 → ICS 링크</li>
            <li>Apple iCloud: 캘린더 공유 → 공개 캘린더 → 링크 복사 (webcal:// 그대로 붙여 넣어도 됩니다)</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

function QuickDate({ label, value, current, onPick }: { label: string; value: string; current: string; onPick: (v: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-medium transition-colors",
        current === value ? "bg-ink text-white" : "bg-black/5 text-ink-2 hover:bg-black/10",
      )}
    >
      {label}
    </button>
  );
}
