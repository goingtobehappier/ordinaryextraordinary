"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createClient } from "@/lib/supabase/client";
import { addDays, isDoneOn, isOverdue, todayISO } from "@/lib/date";
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
};

const supabase = () => createClient();

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
      clearTags: () => set({ activeTags: [], activeCategories: [] }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setShortcut: (action, combo) =>
        set((s) => ({ shortcuts: { ...s.shortcuts, [action]: combo } })),
      resetShortcuts: () => set({ shortcuts: DEFAULT_SHORTCUTS }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      setError: (msg) => set({ error: msg }),

      loadRange: async (start, end, force = false) => {
        const key = `${start}_${end}`;
        const loaded = get().loadedRange;
        // 이미 더 넓은 범위를 불러왔다면 재요청하지 않음
        if (!force && loaded) {
          const [ls, le] = loaded.split("_");
          if (ls <= start && le >= end) return;
        }
        const userId = uid();
        if (!userId) return;
        set({ loading: true, loadedRange: key });

        // 단일 일정은 범위 안, 반복 일정은 범위 마지막 날 이전에 시작한 것 전부
        const { data, error } = await supabase()
          .from("todos")
          .select("*")
          .eq("user_id", userId)
          .or(`and(repeat.eq.none,date.gte.${start},date.lte.${end}),and(repeat.neq.none,date.lte.${end})`)
          .order("start_time", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });

        if (get().loadedRange !== key) return; // 더 최근 요청이 있음
        if (error) set({ loading: false, error: error.message });
        else {
          const todos = (data ?? []).map(normalizeTodo);
          set((s) => ({ loading: false, todos, overdue: recomputeOverdue(s.overdue, todos) }));
        }
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
        const { error } = await supabase().from("todos").update(patch).eq("id", id).eq("user_id", uid() ?? "");
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
        const { data, error } = await supabase()
          .from("todos")
          .delete()
          .eq("id", id)
          .eq("user_id", uid() ?? "")
          .select("id");
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
