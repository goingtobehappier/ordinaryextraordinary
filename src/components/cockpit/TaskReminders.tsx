"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCockpit } from "@/store/cockpit";
import { isDoneOn, occursOn, shortTime, timeToMinutes, toISODate, endTimeLabel } from "@/lib/date";
import { CATEGORY_STYLE, normalizeTodo, type Todo } from "@/lib/types";
import { cn } from "@/lib/cn";
import { CategoryBadge } from "@/components/ui/Glass";
import { useAlarm } from "@/store/alarm";
import { formatAlarm, installAudioUnlock, playChime, showSystemNotification } from "@/lib/alarm";
import { removePushSubscription, syncPushSubscription } from "@/lib/pushSubscription";

/** 시작 몇 분 전부터 알릴지 */
const LEAD_MIN = 5;
/** 시작 후 몇 분까지는 늦게 열어도 알릴지 (그 이후는 지난 알림으로 보고 띄우지 않음) */
const GRACE_MIN = 10;
/** 정각 알람: 시작 후 몇 분까지 늦게 열어도 울릴지 */
const START_GRACE_MIN = 2;
/** 시간 확인 주기 */
const TICK_MS = 15_000;
/** 동시에 보여줄 최대 알림 수 */
const MAX_VISIBLE = 3;
/** 퇴장 애니메이션 길이 (globals.css의 reminder-out과 맞춤) */
const EXIT_MS = 260;

type Reminder = { key: string; todoId: string; date: string; leaving: boolean };

/** 같은 과업이라도 날짜·시간이 바뀌면 새 알림으로 취급 */
const reminderKey = (t: Todo, date: string) => `${t.id}|${date}|${shortTime(t.start_time)}`;

// ───────────── 알림 확인 상태 (사용자·날짜별 localStorage) ─────────────
type SeenStore = { date: string; keys: string[] };
/** reminders: 확인한 토스트 · alarms: 이미 울린 알람(여러 탭 중복 방지) */
type SeenKind = "reminders" | "alarms";
const storageKey = (userId: string, kind: SeenKind) => `cockpit-${kind}:${userId}`;

function readSeen(userId: string, date: string, kind: SeenKind = "reminders"): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(userId, kind));
    const parsed = raw ? (JSON.parse(raw) as SeenStore) : null;
    // 날짜가 바뀌면 지난 기록은 버림
    return new Set(parsed?.date === date && Array.isArray(parsed.keys) ? parsed.keys : []);
  } catch {
    return new Set();
  }
}

function writeSeen(userId: string, date: string, keys: Set<string>, kind: SeenKind = "reminders") {
  try {
    localStorage.setItem(storageKey(userId, kind), JSON.stringify({ date, keys: [...keys] } satisfies SeenStore));
  } catch {
    // 저장소를 쓸 수 없으면 이번 세션 메모리로만 관리
  }
}

/**
 * 오늘 시간이 지정된 과업 목록.
 * 스토어는 현재 보고 있는 범위만 불러오므로(다른 달을 보고 있을 수 있음) 오늘 것은 따로 조회하고,
 * 스토어에 같은 과업이 있으면 그쪽(낙관적 업데이트가 반영된 최신 상태)을 우선함.
 */
function useTodayTimedTodos(userId: string, today: string) {
  const rev = useCockpit((s) => s.rev);
  const storeTodos = useCockpit((s) => s.todos);
  const [fetched, setFetched] = useState<Todo[]>([]);

  useEffect(() => {
    let cancelled = false;
    void createClient()
      .from("todos")
      .select("*")
      .eq("user_id", userId)
      .not("start_time", "is", null)
      .lte("date", today)
      .or(`repeat.neq.none,date.eq.${today}`)
      .then(({ data, error }) => {
        if (!cancelled && !error) setFetched((data ?? []).map(normalizeTodo));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, today, rev]);

  return useMemo(() => {
    const byId = new Map<string, Todo>();
    fetched.forEach((t) => byId.set(t.id, t));
    storeTodos.forEach((t) => byId.set(t.id, t));
    // 삭제는 rev 증가 → 재조회로 반영됨
    return [...byId.values()].filter((t) => t.start_time && occursOn(t, today));
  }, [fetched, storeTodos, today]);
}

/**
 * 타임테이블 알람 (알림 켜짐일 때): 시작 LEAD_MIN분 전 '미리 알림', 시작 시각 '정각 알림'
 *  - 시스템 알림(권한 허용 시) + 은은한 알람음
 *  - 과업·날짜·시각·단계별로 한 번만 (localStorage 기록 → 새로고침·여러 탭에서도 중복 없음)
 */
function fireAlarms(userId: string, date: string, nowMin: number, list: Todo[]) {
  if (!useAlarm.getState().enabled) return;
  const fired = readSeen(userId, date, "alarms");
  const alarms: { todo: Todo; phase: "pre" | "start"; start: number }[] = [];
  for (const todo of list) {
    const start = timeToMinutes(todo.start_time);
    if (start === null || isDoneOn(todo, date)) continue;
    const phase =
      nowMin >= start && nowMin <= start + START_GRACE_MIN ? "start" : nowMin >= start - LEAD_MIN && nowMin < start ? "pre" : null;
    if (!phase) continue;
    const base = reminderKey(todo, date);
    if (fired.has(`${base}|${phase}`)) continue;
    fired.add(`${base}|${phase}`);
    // 정각 알람이 울렸으면 미리 알림은 건너뜀 (늦게 연 경우)
    if (phase === "start") fired.add(`${base}|pre`);
    alarms.push({ todo, phase, start });
  }
  if (!alarms.length) return;
  writeSeen(userId, date, fired, "alarms");

  playChime(alarms.some((a) => a.phase === "start") ? "start" : "pre");
  for (const { todo, phase, start } of alarms) {
    const time = `${shortTime(todo.start_time)}${todo.end_time ? ` – ${endTimeLabel(todo.end_time)}` : ""}`;
    const { title, body } = formatAlarm(todo, phase, start - nowMin, time);
    // 서버 푸시(send-alarms)와 같은 tag·문구 → 둘 다 도착해도 알림 하나로 합쳐짐. 미리/정각은 별도 알림
    void showSystemNotification(title, { body, tag: `${reminderKey(todo, date)}|${phase}` });
  }
}

/**
 * 시간 지정 과업 실시간 알림
 * - 시작 LEAD_MIN분 전 ~ 시작 후 GRACE_MIN분 사이에 화면 하단(데스크톱 우측 하단 / 모바일 하단 중앙)에 토스트 표시
 * - '확인' 또는 '완료'를 누른 알림은 오늘 다시 뜨지 않음 (사용자별 localStorage)
 * - 다른 곳에서 완료·삭제된 과업의 알림은 자동으로 닫힘
 */
export function TaskReminders({ userId }: { userId: string }) {
  const toggleDone = useCockpit((s) => s.toggleDone);
  const [now, setNow] = useState(() => new Date());
  const today = toISODate(now);
  const candidates = useTodayTimedTodos(userId, today);
  const [reminders, setReminders] = useState<Reminder[]>([]);

  const seenRef = useRef<{ date: string; keys: Set<string> } | null>(null);
  const seen = useCallback(
    (date: string) => {
      if (seenRef.current?.date !== date) seenRef.current = { date, keys: readSeen(userId, date) };
      return seenRef.current.keys;
    },
    [userId],
  );

  const candidatesRef = useRef(candidates);
  const remindersRef = useRef(reminders);
  useEffect(() => {
    candidatesRef.current = candidates;
    remindersRef.current = reminders;
  });

  /** 알림을 닫는 애니메이션을 시작하고, 끝나면 목록에서 제거 */
  const dismiss = useCallback(
    (key: string, markSeen = true) => {
      const r = remindersRef.current.find((x) => x.key === key);
      if (!r || r.leaving) return;
      if (markSeen) {
        const keys = seen(r.date);
        keys.add(key);
        writeSeen(userId, r.date, keys);
      }
      setReminders((list) => list.map((x) => (x.key === key ? { ...x, leaving: true } : x)));
      window.setTimeout(() => setReminders((list) => list.filter((x) => x.key !== key)), EXIT_MS);
    },
    [seen, userId],
  );

  /** 현재 시각 기준으로 새 알림을 띄우고, 더 이상 유효하지 않은 알림은 닫음 */
  const check = useCallback(() => {
    const current = new Date();
    const date = toISODate(current);
    const nowMin = current.getHours() * 60 + current.getMinutes();
    const seenKeys = seen(date);
    const list = candidatesRef.current;
    const active = remindersRef.current;

    // 완료·삭제·시간 변경된 과업의 알림은 닫기 (확인 기록은 남기지 않음 → 시간이 바뀌면 새로 알림)
    for (const r of active) {
      if (r.leaving) continue;
      const todo = list.find((t) => t.id === r.todoId);
      if (!todo || r.date !== date || isDoneOn(todo, date) || reminderKey(todo, date) !== r.key) dismiss(r.key, false);
    }

    const due = list
      .filter((t) => {
        const start = timeToMinutes(t.start_time);
        if (start === null || isDoneOn(t, date)) return false;
        const key = reminderKey(t, date);
        if (seenKeys.has(key) || active.some((r) => r.key === key)) return false;
        return nowMin >= start - LEAD_MIN && nowMin <= start + GRACE_MIN;
      })
      .sort((a, b) => (timeToMinutes(a.start_time) ?? 0) - (timeToMinutes(b.start_time) ?? 0));

    fireAlarms(userId, date, nowMin, list);

    if (due.length) {
      setReminders((prev) => [
        ...prev,
        ...due
          .filter((t) => !prev.some((r) => r.key === reminderKey(t, date)))
          .map((t) => ({ key: reminderKey(t, date), todoId: t.id, date, leaving: false })),
      ]);
    }
    setNow(current);
  }, [dismiss, seen, userId]);

  // 브라우저 자동재생 정책: 첫 클릭·키 입력 때 알람음 잠금 해제
  useEffect(() => installAudioUnlock(), []);

  // 백그라운드 알림(Web Push): 알림이 켜져 있으면 이 기기 구독을 서버와 맞춤, 꺼지면 해제
  const alarmEnabled = useAlarm((s) => s.enabled);
  useEffect(() => {
    if (alarmEnabled) void syncPushSubscription();
    else void removePushSubscription();
  }, [alarmEnabled, userId]);

  // 주기적으로 시각 확인 + 탭으로 돌아왔을 때 즉시 확인
  useEffect(() => {
    const id = window.setInterval(check, TICK_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  // 과업 목록이 바뀌면(추가·수정·완료) 다음 주기를 기다리지 않고 바로 반영
  useEffect(() => {
    const id = window.setTimeout(check, 0);
    return () => window.clearTimeout(id);
  }, [candidates, check]);

  if (!reminders.length) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const visible = reminders.slice(0, MAX_VISIBLE);
  const hidden = reminders.length - visible.length;

  return (
    <div
      role="region"
      aria-label="과업 시간 알림"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end print:hidden"
      data-keep-selection
    >
      {visible.map((r) => {
        const todo = candidates.find((t) => t.id === r.todoId);
        if (!todo) return null;
        const start = timeToMinutes(todo.start_time) ?? 0;
        const diff = start - nowMin;
        const status = diff > 0 ? `${diff}분 후 시작` : diff === 0 ? "지금 시작" : `${-diff}분 지남`;
        return (
          <div
            key={r.key}
            role="status"
            className={cn(
              "pointer-events-auto relative flex w-full max-w-[380px] overflow-hidden rounded-2xl border border-white/50 bg-white/85 shadow-[0_12px_40px_-8px_rgb(0_0_0/0.25)] backdrop-blur-xl sm:w-[360px]",
              r.leaving
                ? "animate-[reminder-out_260ms_cubic-bezier(0.4,0,1,1)_both]"
                : "animate-[reminder-in_420ms_cubic-bezier(0.32,0.72,0,1)_both]",
            )}
          >
            <span aria-hidden className={cn("w-1.5 shrink-0", CATEGORY_STYLE[todo.category].dot)} />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3.5 pl-3">
              <div className="flex items-start gap-2.5">
                <div
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                    CATEGORY_STYLE[todo.category].badge,
                  )}
                >
                  <BellRing className={cn("size-4", diff <= 0 && "animate-[reminder-ring_1.2s_ease-in-out_2]")} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <CategoryBadge category={todo.category} />
                    <span
                      className={cn(
                        "truncate text-[11px] font-semibold",
                        diff > 0 ? "text-ink-2" : diff === 0 ? "text-apple-blue" : "text-[#d1281e]",
                      )}
                    >
                      {status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-ink">{todo.title}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-ink-2">
                    {shortTime(todo.start_time)}
                    {todo.end_time && ` – ${endTimeLabel(todo.end_time)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(r.key)}
                  className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-ink-2 transition-colors hover:bg-black/5 hover:text-ink"
                  aria-label="알림 닫기"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => dismiss(r.key)}
                  className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-black/5 hover:text-ink active:scale-[0.97]"
                >
                  확인
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dismiss(r.key);
                    if (!isDoneOn(todo, r.date)) void toggleDone(todo, r.date);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-apple-mint px-3 py-1.5 text-[13px] font-medium text-white shadow-sm shadow-apple-mint/30 transition-[background-color,transform] duration-150 hover:bg-[#00b0a8] active:scale-[0.97]"
                >
                  <Check className="size-3.5" />
                  완료
                </button>
              </div>
            </div>
          </div>
        );
      })}
      {hidden > 0 && (
        <div className="pointer-events-auto rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-md animate-[reminder-in_420ms_cubic-bezier(0.32,0.72,0,1)_both]">
          알림 {hidden}개 더 있음
        </div>
      )}
    </div>
  );
}
