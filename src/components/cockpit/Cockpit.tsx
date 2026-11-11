"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isFullView, useCockpit, type ShortcutAction } from "@/store/cockpit";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { addDays, monthGrid, startOfWeek, todayISO } from "@/lib/date";
import type { CockpitUser } from "@/lib/types";
import { GlassPanel } from "@/components/ui/Glass";
import { Header } from "./Header";
import { WeekBar } from "./WeekBar";
import { MonthView } from "./MonthView";
import { SearchView } from "./SearchView";
import { SummaryView } from "./SummaryView";
import { TaskEditModal } from "./TaskEditModal";
import { TodoBoard, NEW_TODO_INPUT_ID } from "./TodoBoard";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { DailyNote, FOCUS_NOTE_EVENT } from "./DailyNote";
import { DayTaskPanel } from "./DayTaskPanel";
import { SEARCH_INPUT_ID } from "./SearchBar";
import { ShortcutSettings } from "./ShortcutSettings";
import { TaskReminders } from "./TaskReminders";
import { CalendarSyncModal } from "./CalendarSyncModal";
import { useCalendar } from "@/store/calendar";
import { useLunch } from "@/store/lunch";

const noopSubscribe = () => () => {};

/** 서버 렌더와 첫 클라이언트 렌더를 일치시키기 위한 마운트 여부 (타임존·localStorage 의존 UI 보호) */
function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** 클릭해도 선택을 유지하는 요소: 조작 가능한 요소 + 명시적으로 표시한 영역 */
const KEEP_SELECTION =
  "button, a, input, textarea, select, label, [role=button], [role=option], [role=combobox], [role=tab], [role=dialog], [contenteditable=true], [data-keep-selection]";

/**
 * 선택 해제 (Deselect)
 * - 빈 배경 / 타임라인 빈 칸 / 바깥 레이아웃 클릭 → 선택 해제
 *   (document 캡처 단계에서 감지하므로 하위 컴포넌트의 stopPropagation과 무관하게 동작)
 * - ESC → 선택 해제 (드롭다운이 열려 있으면 드롭다운이 먼저 닫힘)
 */
function useDeselect() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !useCockpit.getState().selectedTodoId) return;
      const target = e.target as Element | null;
      if (!target?.closest) return;
      // 타임라인 빈 시간 칸 등 data-deselect가 붙은 곳은 버튼이어도 해제
      if (!target.closest("[data-deselect]") && target.closest(KEEP_SELECTION)) return;
      // 텍스트를 드래그 선택한 경우는 제외
      if (window.getSelection()?.toString()) return;
      useCockpit.getState().selectTodo(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      const s = useCockpit.getState();
      if (s.shortcutsOpen) return;
      if (s.selectedTodoId) s.selectTodo(null);
      // 선택된 항목이 없으면 검색 결과 뷰를 닫고 이전 보기로
      else if (isFullView(s.view)) s.closeFullView();
    };
    document.addEventListener("click", onClick, { capture: true });
    // 버블 단계: 드롭다운이 Escape를 처리하며 stopPropagation하면 여기까지 오지 않음
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

function focusById(id: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  el?.focus();
  el?.select?.();
}

/** 이전 사용자의 데이터를 화면·메모리에서 비움 */
function clearUserData(userId: string | null) {
  useCockpit.setState({
    userId,
    todos: [],
    overdue: [],
    allTags: [],
    recentTags: [],
    loadedRange: null,
    selectedTodoId: null,
    selectedDate: todayISO(),
  });
}

/**
 * 세션 리스너: 다른 탭 로그아웃·세션 만료 → 로그인 화면으로,
 * 다른 계정으로 전환 → 서버에서 새 사용자 정보로 다시 렌더링
 */
function useAuthListener(userId: string) {
  const router = useRouter();
  useEffect(() => {
    const {
      data: { subscription },
    } = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearUserData(null);
        router.replace("/login");
        router.refresh();
      } else if (session?.user && session.user.id !== userId) {
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router, userId]);
}

export function Cockpit({ user }: { user: CockpitUser }) {
  const mounted = useMounted();
  const storeUserId = useCockpit((s) => s.userId);

  // 로그인 사용자를 스토어에 등록하고, 사용자가 바뀌면 캐시를 비움.
  // 등록이 끝난 뒤에만 본 화면을 렌더링 → 모든 조회가 처음부터 user_id로 한정됨
  useEffect(() => {
    if (useCockpit.getState().userId === user.id) return;
    clearUserData(user.id);
    void useCockpit.getState().loadAllTags();
    void useCockpit.getState().loadOverdue();
  }, [user.id]);

  useAuthListener(user.id);

  if (!mounted || storeUserId !== user.id) return <CockpitSkeleton />;
  return <CockpitApp user={user} />;
}

function CockpitApp({ user }: { user: CockpitUser }) {
  const selectedDate = useCockpit((s) => s.selectedDate);
  const selectedTodoId = useCockpit((s) => s.selectedTodoId);
  const shortcuts = useCockpit((s) => s.shortcuts);
  const shortcutsOpen = useCockpit((s) => s.shortcutsOpen);
  const view = useCockpit((s) => s.view);
  const loadRange = useCockpit((s) => s.loadRange);
  const error = useCockpit((s) => s.error);
  const clearError = useCockpit((s) => s.clearError);
  const loadCalendar = useCalendar((s) => s.loadEvents);
  const calendarOpen = useCalendar((s) => s.modalOpen);
  const loadLunchSkips = useLunch((s) => s.load);

  // 보기에 맞는 범위만 불러오기 (일간/주간 = 해당 주, 월간 = 6주 그리드)
  const [rangeStart, rangeEnd] = useMemo(() => {
    if (view === "month") {
      const grid = monthGrid(selectedDate);
      return [grid[0], grid[grid.length - 1]];
    }
    const start = startOfWeek(selectedDate);
    return [start, addDays(start, 6)];
  }, [view, selectedDate]);

  useEffect(() => {
    void loadRange(rangeStart, rangeEnd);
  }, [rangeStart, rangeEnd, loadRange, user.id]);

  // 외부 캘린더: 같은 범위만 서버에서 펼쳐 받음 (동기화 시작 날짜 이전은 서버에서 제외)
  useEffect(() => {
    void loadCalendar(rangeStart, rangeEnd);
  }, [rangeStart, rangeEnd, loadCalendar, user.id]);

  // 당일 점심시간 삭제 기록 (테이블이 없으면 점심시간은 기본대로 표시)
  useEffect(() => {
    void loadLunchSkips(rangeStart, rangeEnd);
  }, [rangeStart, rangeEnd, loadLunchSkips, user.id]);

  const bindings = useMemo(() => {
    const s = useCockpit.getState;
    const actions: Record<ShortcutAction, () => void> = {
      newTodo: () => focusById(NEW_TODO_INPUT_ID),
      focusNote: () => window.dispatchEvent(new Event(FOCUS_NOTE_EVENT)),
      focusSearch: () => focusById(SEARCH_INPUT_ID),
      prevDay: () => s().shiftDate(-1),
      nextDay: () => s().shiftDate(1),
      goToday: () => s().setSelectedDate(todayISO()),
      viewDay: () => s().setView("day"),
      viewWeek: () => s().setView("week"),
      viewMonth: () => s().setView("month"),
      viewSummary: () => s().openSummary(),
      closeDetail: () => s().selectTodo(null),
      openShortcuts: () => s().setShortcutsOpen(true),
    };
    return Object.fromEntries(
      (Object.keys(actions) as ShortcutAction[]).map((a) => [shortcuts[a], actions[a]]),
    );
  }, [shortcuts]);

  // 단축키 설정 중에는 녹화 입력과 충돌하지 않도록 비활성화
  useHotkeys(bindings, !shortcutsOpen && !calendarOpen);
  useDeselect();
  // 다른 기기(PC ↔ 모바일)의 변경을 실시간 반영 (사용자당 1회 구독, 언마운트 시 해제)
  useRealtimeSync(user.id);

  return (
    // 데스크톱(lg+): 한 화면 고정 2열 / 태블릿·모바일: 상하 1열로 쌓고 페이지 스크롤
    <div className="flex min-h-dvh flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:h-dvh lg:min-h-[720px] lg:gap-5 lg:p-5 print:block print:h-auto print:min-h-0 print:p-0">
      <Header user={user} />

      <main className="flex min-w-0 flex-col gap-3 sm:gap-4 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] lg:gap-5 print:block">
        <div className="flex min-w-0 flex-col gap-3 sm:gap-4 lg:min-h-0 lg:gap-5 print:block">
          {view === "week" && <WeekBar />}
          {view === "search" ? (
            <SearchView />
          ) : view === "summary" ? (
            <SummaryView />
          ) : view === "month" ? (
            <MonthView />
          ) : (
            <TodoBoard />
          )}
          <div
            className={`grid print:hidden transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              selectedTodoId && !isFullView(view) ? "grid-rows-[1fr] opacity-100" : "-mt-3 grid-rows-[0fr] opacity-0 sm:-mt-4 lg:-mt-5"
            }`}
            aria-hidden={!selectedTodoId || isFullView(view)}
            data-keep-selection
          >
            <div className="min-h-0 overflow-hidden">
              <TaskDetailPanel />
            </div>
          </div>
        </div>

        {view === "month" ? (
          // 월간 보기: 우측 = 선택 날짜의 과업 리스트(상단) + Daily Memopad(하단)
          // 모바일: 상하 / 태블릿: 좌우 2열 / 데스크톱: 우측 열 안에서 상하
          <div className="grid h-[900px] min-w-0 grid-rows-2 gap-3 sm:gap-4 md:h-[480px] md:grid-cols-2 md:grid-rows-1 lg:h-auto lg:min-h-0 lg:grid-cols-1 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-5">
            <DayTaskPanel />
            <DailyNote userId={user.id} />
          </div>
        ) : (
          <DailyNote userId={user.id} className="h-[520px] min-w-0 lg:h-auto" />
        )}
      </main>

      {isFullView(view) && selectedTodoId && <TaskEditModal />}
      {shortcutsOpen && <ShortcutSettings />}
      {calendarOpen && <CalendarSyncModal />}
      <TaskReminders userId={user.id} />

      {error && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-50 print:hidden flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-xl border border-white/40 bg-white/85 px-4 py-3 text-sm text-[#c4271d] shadow-xl backdrop-blur-xl"
        >
          <CircleAlert className="size-4 shrink-0" />
          <span className="min-w-0 break-keep">{error}</span>
          <button onClick={clearError} className="shrink-0 rounded-md p-0.5 text-ink-2 hover:bg-black/5" aria-label="닫기">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export function CockpitSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col gap-3 p-3 sm:gap-4 sm:p-4 lg:h-dvh lg:min-h-[720px] lg:gap-5 lg:p-5">
      <GlassPanel className="h-16 animate-pulse rounded-2xl" />
      <div className="flex flex-col gap-3 sm:gap-4 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] lg:gap-5">
        <div className="flex flex-col gap-3 sm:gap-4 lg:gap-5">
          <GlassPanel className="h-[120px] animate-pulse md:h-[170px]" />
          <GlassPanel className="h-[560px] animate-pulse lg:h-auto lg:flex-1" />
        </div>
        <GlassPanel className="h-[400px] animate-pulse lg:h-auto" />
      </div>
    </div>
  );
}
