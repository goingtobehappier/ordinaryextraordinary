"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createClient } from "@/lib/supabase/client";
import { addDays, addMonths, isDoneOn, isOverdue, todayISO } from "@/lib/date";
import { fetchAllPages } from "@/lib/fetchAll";
import {
  DEFAULT_TAG,
  normalizeTodo,
  type Category,
  type Repeat,
  type Todo,
} from "@/lib/types";

// ───────────────────────────── 단축키 ─────────────────────────────
export type ShortcutAction =
  | "newTodo"
  | "focusNote"
  | "focusSearch"
  | "prevDay"
  | "nextDay"
  | "goToday"
  | "viewDay"
  | "viewWeek"
  | "viewMonth"
  | "viewSummary"
  | "closeDetail"
  | "openShortcuts";

export const SHORTCUT_META: Record<ShortcutAction, string> = {
  newTodo: "새 할 일 추가",
  focusNote: "데일리 노트 포커스",
  focusSearch: "검색창 포커스",
  prevDay: "이전 날짜",
  nextDay: "다음 날짜",
  goToday: "오늘로 이동",
  viewDay: "일간 보기",
  viewWeek: "주간 보기",
  viewMonth: "월간 보기",
  viewSummary: "요약 보기",
  closeDetail: "상세 패널 닫기",
  openShortcuts: "단축키 설정 열기",
};

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  newTodo: "N",
  focusNote: "Alt+M",
  focusSearch: "Alt+K",
  prevDay: "Alt+ArrowLeft",
  nextDay: "Alt+ArrowRight",
  goToday: "Alt+T",
  viewDay: "Alt+1",
  viewWeek: "Alt+2",
  viewMonth: "Alt+3",
  viewSummary: "Alt+4",
  closeDetail: "Alt+W",
  openShortcuts: "Alt+/",
};

// ───────────────────────────── 상태 ─────────────────────────────
export { DEFAULT_TAG };

export type ViewMode = "day" | "week" | "month";
/** 중앙 영역 화면: 일반 보기 + 검색 결과 / 요약 전용 뷰 */
export type MainView = ViewMode | "search" | "summary";

/** 중앙 전체를 쓰는 특수 뷰 (상세는 모달로 편집) */
export const isFullView = (v: MainView): v is "search" | "summary" => v === "search" || v === "summary";

export type DateRange = { start: string; end: string };

const orderRange = (r: DateRange): DateRange => (r.start <= r.end ? r : { start: r.end, end: r.start });

/** 기본 조회 기간(검색·요약): 올해 1월 1일 ~ 오늘 */
export function defaultSearchRange(): DateRange {
  const today = todayISO();
  return { start: `${today.slice(0, 4)}-01-01`, end: today };
}

/** 태그 필수 규칙: 공백 제거 후 비어 있으면 기본 태그 */
const requireTags = (tags: string[]) => {
  const clean = tags.map((t) => t.trim()).filter(Boolean);
  return clean.length ? clean : [DEFAULT_TAG];
};

/** 최근 사용순 목록 앞에 새로 쓰인 태그를 올림 */
const bumpRecent = (recent: string[], used: string[]) =>
  used.length ? [...new Set([...used, ...recent])] : recent;

const mergeTags = (base: string[], add: string[]) =>
  add.every((t) => base.includes(t)) ? base : Array.from(new Set([...base, ...add])).sort((a, b) => a.localeCompare(b, "ko"));

/** 로드된 todos + 기존 이동 필요 목록에서 이동 필요 항목을 다시 계산 */
const recomputeOverdue = (overdue: Todo[], todos: Todo[]) => {
  const byId = new Map<string, Todo>();
  [...overdue, ...todos].forEach((t) => byId.set(t.id, t));
  // todos 쪽이 최신 상태이므로 덮어씀
  todos.forEach((t) => byId.set(t.id, t));
  return [...byId.values()].filter((t) => isOverdue(t)).sort((a, b) => a.date.localeCompare(b.date));
};

export type NewTodoInput = {
  title: string;
  category: Category;
  date: string;
  start_time: string | null;
  end_time: string | null;
  tags: string[];
  repeat: Repeat;
};

export type TodoPatch = Partial<
  Pick<Todo, "title" | "category" | "date" | "start_time" | "end_time" | "tags" | "repeat" | "completed_dates">
>;

type CockpitState = {
  /** 로그인 사용자 id — 모든 조회/저장에 user_id로 명시 (RLS와 이중 보호) */
  userId: string | null;
  view: MainView;
  /** 검색 뷰를 닫으면 돌아갈 보기 */
  prevView: ViewMode;
  searchRange: DateRange;
  summaryRange: DateRange;
  /** 데이터 변경 카운터 (검색 결과 등 외부 목록 재조회용) */
  rev: number;
  selectedDate: string;
  selectedTodoId: string | null;
  activeTags: string[];
  activeCategories: Category[];
  /** 월간 보기 상단 1차 태그 필터 (비어 있으면 전체) */
  monthCategories: Category[];
  /** 요약 보기 1차 태그 필터 (비어 있으면 전체) */
  summaryCategories: Category[];
  searchQuery: string;
  shortcuts: Record<ShortcutAction, string>;
  shortcutsOpen: boolean;

  todos: Todo[];
  overdue: Todo[];
  allTags: string[];
  /** 2차 태그 최근 사용순 (할 일 생성/등록 시각 기준, 최신이 앞) */
  recentTags: string[];
  loadedRange: string | null;
  loading: boolean;
  error: string | null;

  setUserId: (id: string | null) => void;
  setView: (view: ViewMode) => void;
  openSearch: () => void;
  openSummary: () => void;
  /** 검색/요약 뷰를 닫고 이전 보기로 */
  closeFullView: () => void;
  /** 홈(로고): 주간 보기 · 오늘 날짜로 초기화하고 상세·검색·단축키 창을 닫음 */
  goHome: () => void;
  setSearchRange: (range: DateRange) => void;
  setSummaryRange: (range: DateRange) => void;
  /** 스토어 밖에서 저장한 데이터(상세 메모·데일리 노트) 변경 알림 */
  bumpRev: () => void;
  /** 로드 범위 밖의 할 일(검색 결과 등)을 상세 패널에서 열 수 있도록 추가 */
  ensureTodo: (todo: Todo) => void;
  setSelectedDate: (date: string) => void;
  shiftDate: (days: number) => void;
  selectTodo: (id: string | null) => void;
  toggleTag: (tag: string) => void;
  toggleCategory: (c: Category) => void;
  toggleMonthCategory: (c: Category) => void;
  clearMonthCategories: () => void;
  toggleSummaryCategory: (c: Category) => void;
  clearSummaryCategories: () => void;
  /** 일간·주간 1차 태그 필터만 해제 (2차 태그 필터는 유지) */
  clearCategories: () => void;
  clearTags: () => void;
  setSearchQuery: (q: string) => void;
  setShortcut: (action: ShortcutAction, combo: string) => void;
  resetShortcuts: () => void;
  setShortcutsOpen: (open: boolean) => void;
  setError: (msg: string | null) => void;

  loadRange: (start: string, end: string, force?: boolean) => Promise<void>;
  loadOverdue: () => Promise<void>;
  loadAllTags: () => Promise<void>;
  addTodo: (input: NewTodoInput) => Promise<Todo | null>;
  updateTodo: (id: string, patch: TodoPatch) => Promise<void>;
  moveTodoToDate: (todo: Todo, date: string) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  toggleDone: (todo: Todo, date: string) => Promise<void>;
  clearError: () => void;

  /** Realtime: 다른 기기에서 추가·수정된 할 일을 반영 (로드 범위 밖이면 목록에서 제외) */
  applyRemoteTodo: (row: Record<string, unknown>) => void;
  /** Realtime: 다른 기기에서 삭제된 할 일을 제거 */
  removeRemoteTodo: (id: string) => void;
  /** 재연결·앱 복귀 시 놓친 변경을 다시 불러옴 */
  resync: () => Promise<void>;
};

/**
 * 이 기기에서 저장 중인 할 일 id별 요청 수.
 * 저장 중에는 앞선 저장의 Realtime 메아리가 낙관적 상태를 되돌리지 않도록 원격 반영을 건너뜀
 * (마지막 저장의 메아리는 요청이 끝난 뒤 도착해 최종 상태로 맞춰짐).
 */
const pendingWrites = new Map<string, number>();
const beginWrite = (id: string) => pendingWrites.set(id, (pendingWrites.get(id) ?? 0) + 1);
const endWrite = (id: string) => {
  const n = (pendingWrites.get(id) ?? 1) - 1;
  if (n > 0) pendingWrites.set(id, n);
  else pendingWrites.delete(id);
};

/** 로드된 범위(loadRange 조건과 동일)에 포함되는 할 일인지 */
const inLoadedRange = (t: Todo, loadedRange: string | null) => {
  if (!loadedRange) return false;
  const [start, end] = loadedRange.split("_");
  return t.repeat === "none" ? t.date >= start && t.date <= end : t.date <= end;
};

const supabase = () => createClient();

// ───────────────────────── 캘린더 조회 캐시 ─────────────────────────
/** 기준 날짜 앞뒤로 미리 불러올 개월 수 */
const WINDOW_MONTHS = 2;
/** 한 번의 구간 조회에서 받을 최대 건수 (서버 max-rows에 잘리지 않도록 페이지로 나눠 받음) */
const RANGE_LIMIT = 20000;
const RANGE_PAGE = 1000;
/** 캐시를 이어 붙였을 때 이 일수를 넘으면 새 구간으로 교체 (메모리·Realtime 처리량 제한) */
const MAX_CACHE_DAYS = 400;

const parseRange = (key: string | null): DateRange | null => {
  if (!key) return null;
  const [start, end] = key.split("_");
  return { start, end };
};
const rangeKey = (r: DateRange) => `${r.start}_${r.end}`;
const minISO = (a: string, b: string) => (a < b ? a : b);
const maxISO = (a: string, b: string) => (a > b ? a : b);
const spanDays = (r: DateRange) => (Date.parse(r.end) - Date.parse(r.start)) / 86_400_000;

/** 화면 정렬 기준 (시작 시각 → 생성 시각, 시간 없는 일정은 뒤로) */
const byStartThenCreated = (a: Todo, b: Todo) =>
  (a.start_time ?? "~").localeCompare(b.start_time ?? "~") || a.created_at.localeCompare(b.created_at);

/**
 * 구간 조회.
 * - withRepeatBefore: 구간 시작 전에 시작한 반복 일정도 포함 (캐시를 새로 만들 때만 필요.
 *   이어 붙이는 구간에서는 이미 받은 범위에 들어 있음)
 */
async function fetchTodosRange(userId: string, r: DateRange, withRepeatBefore: boolean) {
  const filter = withRepeatBefore
    ? `and(date.gte.${r.start},date.lte.${r.end}),and(repeat.neq.none,date.lt.${r.start})`
    : `and(date.gte.${r.start},date.lte.${r.end})`;
  const res = await fetchAllPages(
    (from, to) =>
      supabase()
        .from("todos")
        .select("*")
        .eq("user_id", userId)
        .or(filter)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    { pageSize: RANGE_PAGE, max: RANGE_LIMIT },
  );
  return { todos: res.data.map(normalizeTodo), error: res.error, truncated: res.truncated };
}

/** 동시에 진행 중인 구간 조회 수 (loading 표시용) */
let inflight = 0;
/** 캐시를 통째로 교체할 때마다 증가 — 교체 전에 출발한 이어 붙이기 응답은 버림 */
let cacheGen = 0;

export const useCockpit = create<CockpitState>()(
  persist(
    (set, get) => {
      /** 로그인 사용자 id (없으면 null → 요청하지 않음) */
      const uid = () => get().userId;
      return {
      userId: null,
      view: "week",
      prevView: "week",
      searchRange: defaultSearchRange(),
      summaryRange: defaultSearchRange(),
      rev: 0,
      selectedDate: todayISO(),
      selectedTodoId: null,
      activeTags: [],
      activeCategories: [],
      monthCategories: [],
      summaryCategories: [],
      searchQuery: "",
      shortcuts: DEFAULT_SHORTCUTS,
      shortcutsOpen: false,

      todos: [],
      overdue: [],
      allTags: [],
      recentTags: [],
      loadedRange: null,
      loading: false,
      error: null,

      setUserId: (id) => set({ userId: id }),
      setView: (view) => set({ view, prevView: view }),
      openSearch: () =>
        set((s) => ({ view: "search", prevView: isFullView(s.view) ? s.prevView : s.view, selectedTodoId: null })),
      openSummary: () =>
        set((s) => ({ view: "summary", prevView: isFullView(s.view) ? s.prevView : s.view, selectedTodoId: null })),
      closeFullView: () => set((s) => ({ view: s.prevView, selectedTodoId: null })),
      goHome: () =>
        set({
          view: "week",
          prevView: "week",
          selectedDate: todayISO(),
          selectedTodoId: null,
          searchQuery: "",
          shortcutsOpen: false,
        }),
      // 시작일이 종료일보다 늦으면 서로 맞춤
      setSearchRange: (range) => set({ searchRange: orderRange(range) }),
      setSummaryRange: (range) => set({ summaryRange: orderRange(range) }),
      bumpRev: () => set((s) => ({ rev: s.rev + 1 })),
      ensureTodo: (todo) =>
        set((s) => (s.todos.some((t) => t.id === todo.id) ? s : { todos: [...s.todos, todo] })),
      setSelectedDate: (date) => set({ selectedDate: date, selectedTodoId: null }),
      shiftDate: (days) => get().setSelectedDate(addDays(get().selectedDate, days)),
      selectTodo: (id) => set({ selectedTodoId: id }),
      toggleTag: (tag) =>
        set((s) => ({
          activeTags: s.activeTags.includes(tag)
            ? s.activeTags.filter((t) => t !== tag)
            : [...s.activeTags, tag],
        })),
      toggleCategory: (c) =>
        set((s) => ({
          activeCategories: s.activeCategories.includes(c)
            ? s.activeCategories.filter((x) => x !== c)
            : [...s.activeCategories, c],
        })),
      toggleMonthCategory: (c) =>
        set((s) => ({
          monthCategories: s.monthCategories.includes(c)
            ? s.monthCategories.filter((x) => x !== c)
            : [...s.monthCategories, c],
        })),
      clearMonthCategories: () => set({ monthCategories: [] }),
      toggleSummaryCategory: (c) =>
        set((s) => ({
          summaryCategories: s.summaryCategories.includes(c)
            ? s.summaryCategories.filter((x) => x !== c)
            : [...s.summaryCategories, c],
        })),
      clearSummaryCategories: () => set({ summaryCategories: [] }),
      clearCategories: () => set({ activeCategories: [] }),
      clearTags: () => set({ activeTags: [], activeCategories: [] }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setShortcut: (action, combo) =>
        set((s) => ({ shortcuts: { ...s.shortcuts, [action]: combo } })),
      resetShortcuts: () => set({ shortcuts: DEFAULT_SHORTCUTS }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      setError: (msg) => set({ error: msg }),

      loadRange: async (start, end, force = false) => {
        const userId = uid();
        if (!userId) return;
        // 필요한 구간: 보이는 범위 + 기준 날짜(selectedDate) 앞뒤 2개월.
        // 월 단위로 맞춰서 같은 달 안에서 날짜를 옮길 때는 재조회하지 않음
        const monthStart = `${get().selectedDate.slice(0, 7)}-01`;
        const want: DateRange = {
          start: minISO(start, addMonths(monthStart, -WINDOW_MONTHS)),
          end: maxISO(end, addDays(addMonths(monthStart, WINDOW_MONTHS + 1), -1)),
        };
        const loaded = parseRange(get().loadedRange);
        // 이미 캐시에 다 들어 있으면 재요청하지 않음
        if (!force && loaded && loaded.start <= want.start && loaded.end >= want.end) return;

        // 기존 캐시와 맞닿거나 겹치면 빠진 구간만 받아 병합, 아니면(멀리 점프·강제 새로고침) 교체
        const union = loaded && { start: minISO(loaded.start, want.start), end: maxISO(loaded.end, want.end) };
        const touches = !!loaded && want.start <= addDays(loaded.end, 1) && want.end >= addDays(loaded.start, -1);
        const fits = !!union && touches && spanDays(union) <= MAX_CACHE_DAYS;
        const extend = !force && fits;
        // 강제 새로고침(재연결 등)은 지금까지 받은 범위 전체를 다시 받음
        const target = fits ? union! : want;
        const gen = extend ? cacheGen : ++cacheGen;
        inflight++;
        set({ loading: true, loadedRange: rangeKey(target) });

        let results: Awaited<ReturnType<typeof fetchTodosRange>>[];
        if (extend) {
          const gaps: DateRange[] = [];
          if (want.start < loaded!.start) gaps.push({ start: want.start, end: addDays(loaded!.start, -1) });
          if (want.end > loaded!.end) gaps.push({ start: addDays(loaded!.end, 1), end: want.end });
          results = await Promise.all(gaps.map((g) => fetchTodosRange(userId, g, false)));
        } else {
          results = [await fetchTodosRange(userId, target, true)];
        }
        inflight--;

        if (gen !== cacheGen || uid() !== userId) {
          if (!inflight) set({ loading: false });
          return; // 그 사이 캐시가 교체됨 (더 최근 요청이 있음)
        }
        const failed = results.find((r) => r.error);
        if (failed) {
          // 빠진 구간이 생기지 않도록 캐시 범위를 무효화 → 다음 이동 때 새로 받음
          set({ loading: inflight > 0, loadedRange: null, error: failed.error!.message });
          return;
        }
        if (results.some((r) => r.truncated)) {
          set({ error: `한 번에 불러올 수 있는 일정 수(${RANGE_LIMIT.toLocaleString()}건)를 넘어 일부만 표시됩니다.` });
        }

        const fetched = results.flatMap((r) => r.todos);
        set((s) => {
          const byId = new Map<string, Todo>();
          if (extend) s.todos.forEach((t) => byId.set(t.id, t));
          // 서버 값으로 갱신. 저장 중인 항목은 낙관적 상태(로컬 값)를 유지
          for (const t of fetched) if (!pendingWrites.has(t.id) || !byId.has(t.id)) byId.set(t.id, t);
          const todos = [...byId.values()].sort(byStartThenCreated);
          return { loading: inflight > 0, todos, overdue: recomputeOverdue(s.overdue, todos) };
        });
      },

      loadOverdue: async () => {
        const userId = uid();
        if (!userId) return;
        const { data, error } = await supabase()
          .from("todos")
          .select("*")
          .eq("user_id", userId)
          .eq("repeat", "none")
          .lt("date", todayISO())
          .order("date", { ascending: true })
          .limit(300);
        if (error) return;
        set((s) => ({ overdue: recomputeOverdue((data ?? []).map(normalizeTodo), s.todos) }));
      },

      loadAllTags: async () => {
        // 태그 콤보박스용: 내 할 일 전체에서 사용된 태그
        const userId = uid();
        if (!userId) return;
        const { data, error } = await supabase()
          .from("todos")
          .select("tags, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(5000);
        if (error) return;
        // 최신 할 일부터 순회 → 처음 등장한 순서가 곧 최근 사용순
        const tags = (data ?? []).flatMap((r: { tags: string[] | null }) => r.tags ?? []);
        set((s) => ({
          allTags: mergeTags(s.allTags, [DEFAULT_TAG, ...tags]),
          recentTags: bumpRecent([...new Set(tags)], s.recentTags),
        }));
      },

      addTodo: async (input) => {
        const userId = uid();
        if (!userId) {
          set({ error: "로그인이 필요합니다." });
          return null;
        }
        const { data, error } = await supabase()
          .from("todos")
          .insert({ ...input, user_id: userId, tags: requireTags(input.tags) })
          .select()
          .single();
        if (error) {
          set({ error: error.message });
          return null;
        }
        const todo = normalizeTodo(data);
        set((s) => ({
          todos: [...s.todos, todo],
          rev: s.rev + 1,
          allTags: mergeTags(s.allTags, todo.tags),
          recentTags: bumpRecent(s.recentTags, todo.tags),
        }));
        return todo;
      },

      updateTodo: async (id, rawPatch) => {
        const patch = rawPatch.tags ? { ...rawPatch, tags: requireTags(rawPatch.tags) } : rawPatch;
        const prev = get().todos;
        const prevOverdue = get().overdue;
        const apply = (t: Todo) => (t.id === id ? { ...t, ...patch } : t);
        // 이 할 일에 새로 등록된 태그만 최근 사용으로 올림
        const before = prev.find((t) => t.id === id)?.tags ?? [];
        const newlyAdded = patch.tags?.filter((t) => !before.includes(t)) ?? [];
        const todos = prev.map(apply);
        set((s) => ({
          todos,
          overdue: recomputeOverdue(s.overdue.map(apply), todos),
          allTags: patch.tags ? mergeTags(s.allTags, patch.tags) : s.allTags,
          recentTags: bumpRecent(s.recentTags, newlyAdded),
        }));
        beginWrite(id);
        const { error } = await supabase().from("todos").update(patch).eq("id", id).eq("user_id", uid() ?? "");
        endWrite(id);
        if (error) set({ todos: prev, overdue: prevOverdue, error: error.message });
        else set((s) => ({ rev: s.rev + 1 }));
      },

      moveTodoToDate: async (todo, date) => {
        if (todo.date === date) return;
        if (todo.repeat !== "none") {
          set({ error: "반복 일정은 상세 패널에서 시작일·반복을 변경하세요." });
          return;
        }
        const wasDone = todo.completed_dates.includes(todo.date);
        // 목록에 없던(이동 필요 목록에서 온) 항목도 화면에 보이도록 추가
        if (!get().todos.some((t) => t.id === todo.id)) set((s) => ({ todos: [...s.todos, todo] }));
        await get().updateTodo(todo.id, {
          date,
          completed_dates: wasDone ? [date] : [],
        });
      },

      deleteTodo: async (id) => {
        const prev = get().todos;
        const prevOverdue = get().overdue;
        set({
          todos: prev.filter((t) => t.id !== id),
          overdue: prevOverdue.filter((t) => t.id !== id),
          selectedTodoId: get().selectedTodoId === id ? null : get().selectedTodoId,
        });
        beginWrite(id);
        const { data, error } = await supabase()
          .from("todos")
          .delete()
          .eq("id", id)
          .eq("user_id", uid() ?? "")
          .select("id");
        endWrite(id);
        // RLS로 걸러지면 오류 없이 0건 삭제되므로, 실제 삭제 건수까지 확인
        if (error || !data?.length) {
          set({ todos: prev, overdue: prevOverdue, error: error?.message ?? "과업을 삭제하지 못했습니다. 다시 시도해 주세요." });
        } else set((s) => ({ rev: s.rev + 1 }));
      },

      toggleDone: async (todo, date) => {
        const completed_dates = isDoneOn(todo, date)
          ? todo.completed_dates.filter((d) => d !== date)
          : [...todo.completed_dates, date];
        await get().updateTodo(todo.id, { completed_dates });
      },

      clearError: () => set({ error: null }),

      applyRemoteTodo: (row) => {
        const todo = normalizeTodo(row);
        if (!todo.id || todo.user_id !== uid() || pendingWrites.has(todo.id)) return;
        set((s) => {
          const exists = s.todos.some((t) => t.id === todo.id);
          const todos = inLoadedRange(todo, s.loadedRange)
            ? exists
              ? s.todos.map((t) => (t.id === todo.id ? todo : t))
              : [...s.todos, todo]
            : s.todos.filter((t) => t.id !== todo.id);
          return {
            todos,
            overdue: recomputeOverdue(
              [...s.overdue.filter((t) => t.id !== todo.id), ...(isOverdue(todo) ? [todo] : [])],
              todos,
            ),
            rev: s.rev + 1,
            allTags: mergeTags(s.allTags, todo.tags),
          };
        });
      },

      removeRemoteTodo: (id) => {
        // DELETE 이벤트는 user_id로 걸러지지 않으므로(기본키만 전달) 화면에 있는 항목만 처리
        const s0 = get();
        if (pendingWrites.has(id) || !(s0.todos.some((t) => t.id === id) || s0.overdue.some((t) => t.id === id))) return;
        set((s) => ({
          todos: s.todos.filter((t) => t.id !== id),
          overdue: s.overdue.filter((t) => t.id !== id),
          selectedTodoId: s.selectedTodoId === id ? null : s.selectedTodoId,
          rev: s.rev + 1,
        }));
      },

      resync: async () => {
        const range = get().loadedRange;
        if (range) {
          const [start, end] = range.split("_");
          await get().loadRange(start, end, true);
        }
        await get().loadOverdue();
        set((s) => ({ rev: s.rev + 1 }));
      },
      };
    },
    {
      name: "cockpit-prefs",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // v0 → v1: '새 할 일' 기본 단축키 Alt+N → N (사용자가 바꾼 값은 유지)
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<CockpitState>;
        if (version < 1 && p.shortcuts?.newTodo === "Alt+N") {
          p.shortcuts = { ...p.shortcuts, newTodo: "N" };
        }
        return p as CockpitState;
      },
      // 사용자 환경설정만 저장 (데이터는 Supabase가 원본)
      partialize: (s) => ({
        shortcuts: s.shortcuts,
        activeTags: s.activeTags,
        activeCategories: s.activeCategories,
        monthCategories: s.monthCategories,
        summaryCategories: s.summaryCategories,
        // 검색 뷰는 저장하지 않고 원래 보기로 복원
        view: isFullView(s.view) ? s.prevView : s.view,
        prevView: s.prevView,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<CockpitState> | undefined;
        return {
          ...current,
          ...p,
          shortcuts: { ...DEFAULT_SHORTCUTS, ...(p?.shortcuts ?? {}) },
        };
      },
    },
  ),
);
