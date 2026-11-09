export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";

/** 1차 태그 (필수, 단일 선택) */
export const CATEGORIES = ["일정", "미팅", "보고", "마감", "회의", "업무"] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULT_CATEGORY: Category = "업무";

/** 카테고리별 색상 (badge: 목록용, block: 타임블록용, dot: 캘린더용) */
export const CATEGORY_STYLE: Record<Category, { badge: string; block: string; dot: string }> = {
  일정: { badge: "bg-[#007aff]/12 text-[#0062cc]", block: "border-[#007aff] bg-[#007aff]/15 text-[#0057b8]", dot: "bg-[#007aff]" },
  미팅: { badge: "bg-[#af52de]/12 text-[#8e3bb8]", block: "border-[#af52de] bg-[#af52de]/15 text-[#7f2fa8]", dot: "bg-[#af52de]" },
  보고: { badge: "bg-[#ff9500]/14 text-[#b86b00]", block: "border-[#ff9500] bg-[#ff9500]/15 text-[#a35f00]", dot: "bg-[#ff9500]" },
  마감: { badge: "bg-[#ff3b30]/12 text-[#d1281e]", block: "border-[#ff3b30] bg-[#ff3b30]/14 text-[#c4271d]", dot: "bg-[#ff3b30]" },
  회의: { badge: "bg-[#5856d6]/12 text-[#4644b8]", block: "border-[#5856d6] bg-[#5856d6]/15 text-[#3f3da8]", dot: "bg-[#5856d6]" },
  업무: { badge: "bg-[#00c7be]/14 text-[#00857f]", block: "border-[#00c7be] bg-[#00c7be]/15 text-[#007a74]", dot: "bg-[#00c7be]" },
};

export function isCategory(v: unknown): v is Category {
  return CATEGORIES.includes(v as Category);
}

export type Todo = {
  id: string;
  user_id: string;
  title: string;
  category: Category;
  date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM[:SS]
  end_time: string | null;
  tags: string[];
  repeat: Repeat;
  completed_dates: string[];
  created_at: string;
  updated_at: string;
};

export const DEFAULT_TAG = "기타업무";

const REPEATS: Repeat[] = ["none", "daily", "weekdays", "weekly", "monthly"];

/** DB 행을 앱 형태로 정규화 (컬럼 누락·null이어도 안전하게) */
export function normalizeTodo(row: Record<string, unknown>): Todo {
  const r = row as Partial<Todo> & { due_date?: string | null };
  return {
    ...(r as Todo),
    category: isCategory(r.category) ? r.category : DEFAULT_CATEGORY,
    date: (r.date ?? r.due_date ?? r.created_at ?? "").slice(0, 10),
    // 태그는 필수: 비어 있는 기존 데이터는 기본 태그로 표시
    tags: Array.isArray(r.tags) && r.tags.length ? r.tags : [DEFAULT_TAG],
    repeat: REPEATS.includes(r.repeat as Repeat) ? (r.repeat as Repeat) : "none",
    completed_dates: Array.isArray(r.completed_dates) ? r.completed_dates : [],
  };
}

export type Subtask = { id: string; text: string; done: boolean };

export type TodoDetail = {
  todo_id: string;
  user_id: string;
  memo: string;
  subtasks: Subtask[];
  updated_at: string;
};

export type DailyNote = {
  id: string;
  user_id: string;
  date: string;
  content: string;
  updated_at: string;
};

export type CockpitUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export const REPEAT_LABEL: Record<Repeat, string> = {
  none: "반복 없음",
  daily: "매일",
  weekdays: "평일",
  weekly: "매주",
  monthly: "매월",
};
