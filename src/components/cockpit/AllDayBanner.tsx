"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  ALL_DAY_COLORS,
  ALL_DAY_EMOJIS,
  ALL_DAY_PRESETS,
  coversDate,
  useAllDay,
  type AllDayEvent,
  type AllDayInput,
} from "@/store/allDay";
import { cn } from "@/lib/cn";
import { GlassButton, GlassInput } from "@/components/ui/Glass";

/** "2026-11-10" → "11/10" */
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** 칩 배경·테두리용 반투명 색 (#rrggbb + alpha) */
const tint = (hex: string, alpha: string) => `${hex}${alpha}`;

type Editing = { mode: "add" } | { mode: "edit"; event: AllDayEvent } | null;

/**
 * 종일 일정 배너: 날짜 표시 영역 바로 아래에 고정.
 * 해당 날짜에 걸치는 연차·휴가·여행 등을 색상 칩으로 보여 주고, 칩을 누르면 수정·삭제, '+'로 추가.
 */
export function AllDayBanner({ date, className }: { date: string; className?: string }) {
  const events = useAllDay((s) => s.events).filter((e) => coversDate(e, date));
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <div
      className={cn("flex min-w-0 items-center gap-1.5 border-b border-black/5 px-3 py-2 sm:px-6", className)}
      aria-label="종일 일정"
    >
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-ink-2">
        <CalendarDays className="size-3.5" />
        종일
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 scroll-thin">
        {events.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setEditing({ mode: "edit", event: e })}
            title={`${e.title}${e.end_date ? ` (${md(e.date)}–${md(e.end_date)})` : ""} · 눌러서 수정`}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-[filter,transform] hover:brightness-95 active:scale-[0.97]"
            style={{ color: e.color, backgroundColor: tint(e.color, "1f"), borderColor: tint(e.color, "40") }}
          >
            <span aria-hidden>{e.emoji}</span>
            <span className="max-w-[160px] truncate">{e.title}</span>
            {e.end_date && (
              <span className="font-medium tabular-nums opacity-70">
                {md(e.date)}–{md(e.end_date)}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEditing({ mode: "add" })}
          className={cn(
            "flex h-7 shrink-0 items-center gap-0.5 rounded-full border border-dashed border-black/15 px-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-apple-blue/40 hover:text-apple-blue",
          )}
          aria-label="종일 일정 추가"
        >
          <Plus className="size-3.5" />
          {events.length === 0 && <span>종일 일정</span>}
        </button>
      </div>
      {editing && (
        <AllDayDialog
          date={date}
          event={editing.mode === "edit" ? editing.event : null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AllDayDialog({ date, event, onClose }: { date: string; event: AllDayEvent | null; onClose: () => void }) {
  const add = useAllDay((s) => s.add);
  const update = useAllDay((s) => s.update);
  const remove = useAllDay((s) => s.remove);

  const [form, setForm] = useState<AllDayInput>(() =>
    event
      ? { date: event.date, end_date: event.end_date, title: event.title, emoji: event.emoji, color: event.color }
      : { date, end_date: null, title: "", emoji: ALL_DAY_PRESETS[0].emoji, color: ALL_DAY_PRESETS[0].color },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => {
      if (prev?.isConnected) prev.focus();
    };
  }, []);

  const patch = (p: Partial<AllDayInput>) => {
    setForm((f) => ({ ...f, ...p }));
    setError(null);
  };

  const rangeInvalid = !!form.end_date && form.end_date < form.date;
  const canSave = !!form.title.trim() && !!form.date && !rangeInvalid && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    const err = event ? await update(event.id, form) : await add(form);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  async function del() {
    if (!event) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    const err = await remove(event.id);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      data-keep-selection
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/20 backdrop-blur-sm sm:items-center print:hidden"
      onPointerDown={stop}
      onClick={stop}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="all-day-title"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        // 모바일: 하단 시트 / sm 이상: 가운데 다이얼로그
        className="w-full max-w-[420px] rounded-t-2xl border border-white/40 bg-white/90 p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl sm:rounded-2xl sm:pb-5"
      >
        <div className="flex items-center gap-2">
          <h2 id="all-day-title" className="flex-1 text-[15px] font-semibold text-ink">
            {event ? "종일 일정 수정" : "종일 일정 추가"}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-2 hover:bg-black/5" aria-label="닫기">
            <X className="size-4" />
          </button>
        </div>

        {!event && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ALL_DAY_PRESETS.map((p) => {
              const active = form.title === p.title && form.emoji === p.emoji;
              return (
                <button
                  key={p.title}
                  type="button"
                  onClick={() => patch(p)}
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold transition-[box-shadow]",
                    active && "ring-2 ring-current/40",
                  )}
                  style={{ color: p.color, backgroundColor: tint(p.color, "1f"), borderColor: tint(p.color, "40") }}
                >
                  <span aria-hidden>{p.emoji}</span>
                  {p.title}
                </button>
              );
            })}
          </div>
        )}

        <label className="mt-4 block text-xs font-medium text-ink-2" htmlFor="all-day-name">
          이름
        </label>
        <div className="mt-1 flex gap-2">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-lg"
            style={{ backgroundColor: tint(form.color, "1f"), borderColor: tint(form.color, "40") }}
            aria-hidden
          >
            {form.emoji}
          </span>
          <GlassInput
            id="all-day-name"
            ref={titleRef}
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="예: 연차, 가족 여행"
            maxLength={60}
            autoComplete="off"
            className="min-w-0 flex-1"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1" role="radiogroup" aria-label="아이콘">
          {ALL_DAY_EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              role="radio"
              aria-checked={form.emoji === em}
              onClick={() => patch({ emoji: em })}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-base transition-colors",
                form.emoji === em ? "bg-apple-blue/15 ring-1 ring-apple-blue/40" : "hover:bg-black/5",
              )}
            >
              {em}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="색상">
          {ALL_DAY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={form.color === c}
              aria-label={c}
              onClick={() => patch({ color: c })}
              className={cn("size-6 rounded-full transition-transform", form.color === c ? "scale-110 ring-2 ring-offset-2" : "hover:scale-105")}
              style={{ backgroundColor: c, ["--tw-ring-color" as string]: c }}
            />
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="text-xs font-medium text-ink-2">
            시작일
            <GlassInput
              type="date"
              value={form.date}
              onChange={(e) => e.target.value && patch({ date: e.target.value })}
              className="mt-1 w-full tabular-nums"
              required
            />
          </label>
          <label className="text-xs font-medium text-ink-2">
            종료일 <span className="font-normal">(선택)</span>
            <GlassInput
              type="date"
              value={form.end_date ?? ""}
              min={form.date}
              onChange={(e) => patch({ end_date: e.target.value || null })}
              className={cn("mt-1 w-full tabular-nums", rangeInvalid && "ring-2 ring-[#ff3b30]/50")}
            />
          </label>
        </div>

        {(error || rangeInvalid) && (
          <p className="mt-2 break-keep text-xs text-[#c4271d]" role="alert">
            {error ?? "종료일은 시작일 이후여야 합니다."}
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          {event && (
            <GlassButton
              type="button"
              onClick={() => void del()}
              disabled={busy}
              className={cn(
                "gap-1",
                confirmDelete ? "bg-[#ff3b30] text-white hover:bg-[#e0352b] hover:text-white" : "text-[#ff3b30] hover:bg-[#ff3b30]/10",
              )}
            >
              <Trash2 className="size-4" />
              {confirmDelete ? "정말 삭제" : "삭제"}
            </GlassButton>
          )}
          <GlassButton type="button" onClick={onClose} className="ml-auto bg-black/5">
            취소
          </GlassButton>
          <GlassButton type="submit" variant="primary" disabled={!canSave} className="min-w-[64px] justify-center">
            {busy ? <Loader2 className="size-4 animate-spin" /> : "저장"}
          </GlassButton>
        </div>
      </form>
    </div>,
    document.body,
  );
}
