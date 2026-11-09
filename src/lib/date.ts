import type { Repeat, Todo } from "./types";

/** 로컬 타임존 기준 YYYY-MM-DD */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** 해당 날짜가 속한 주의 월요일 */
export function startOfWeek(iso: string): string {
  const d = parseISODate(iso);
  const dow = (d.getDay() + 6) % 7; // 월=0 … 일=6
  d.setDate(d.getDate() - dow);
  return toISODate(d);
}

export function weekDates(iso: string): string[] {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"];

export function weekdayIndex(iso: string): number {
  return (parseISODate(iso).getDay() + 6) % 7;
}

export function formatLong(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAY_KO[weekdayIndex(iso)]}요일`;
}

/** "HH:MM[:SS]" → 분 */
export function timeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function shortTime(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

/** 반복 규칙을 고려해 todo가 특정 날짜에 발생하는지 */
export function occursOn(todo: Pick<Todo, "date" | "repeat">, iso: string): boolean {
  if (iso < todo.date) return false;
  const repeat: Repeat = todo.repeat;
  if (repeat === "none") return iso === todo.date;
  if (repeat === "daily") return true;
  if (repeat === "weekdays") return weekdayIndex(iso) < 5;
  if (repeat === "weekly") return weekdayIndex(iso) === weekdayIndex(todo.date);
  // monthly: 같은 일자. 해당 월에 그 일자가 없으면 말일에 발생
  const base = parseISODate(todo.date).getDate();
  const d = parseISODate(iso);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() === Math.min(base, lastDay);
}

export function isDoneOn(todo: Pick<Todo, "completed_dates">, iso: string): boolean {
  return todo.completed_dates.includes(iso);
}

/** 분 → "HH:MM" (1440분은 하루의 끝 23:59로 표기) */
export function minutesToTime(m: number): string {
  const v = Math.max(0, Math.min(m, 1439));
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

/** 월 달력 그리드 (월요일 시작, 6주 = 42일) */
export function monthGrid(iso: string): string[] {
  const d = parseISODate(iso);
  const first = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** 이동 필요: 지난 날짜의 미완료 단일 일정 */
export function isOverdue(todo: Pick<Todo, "date" | "repeat" | "completed_dates">, today = todayISO()): boolean {
  return todo.repeat === "none" && todo.date < today && !todo.completed_dates.includes(todo.date);
}
