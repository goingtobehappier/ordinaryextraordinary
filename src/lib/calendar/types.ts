/** 외부 캘린더(iCal/ICS) 구독 정보 — calendar_sources 테이블 한 행 */
export type CalendarSource = {
  id: string;
  name: string;
  url: string;
  /** 이 날짜(YYYY-MM-DD) 이후의 일정만 불러옴 */
  sync_start: string;
  color: string;
  created_at: string;
};

/** 화면에 표시할 외부 일정 한 건 (반복 일정은 발생일마다 1건, 여러 날 일정은 날짜마다 1건) */
export type CalendarEvent = {
  /** 소스·UID·발생 시점·날짜 조합 (React key) */
  id: string;
  sourceId: string;
  title: string;
  /** 사용자 시간대 기준 날짜 YYYY-MM-DD */
  date: string;
  /** HH:MM (종일 일정은 null) */
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
};

export type CalendarSourceError = { sourceId: string; message: string };

export type CalendarResponse = {
  events: CalendarEvent[];
  errors: CalendarSourceError[];
};

/** 소스 색상 팔레트 (추가 순서대로 순환) */
export const SOURCE_COLORS = ["#8e44ad", "#0a84ff", "#ff9500", "#34c759", "#ff2d55", "#5ac8fa"] as const;

/** URL 형식 확인 (webcal:// 은 https:// 로 취급) */
export function normalizeCalendarUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/^webcals?:\/\//i, "https://");
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
