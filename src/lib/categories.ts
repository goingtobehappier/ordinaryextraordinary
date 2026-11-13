import { CATEGORY_COUNT, DEFAULT_CATEGORIES, WORK_SLOT } from "./types";

/** 1차 태그 이름 최대 길이 (DB 제약과 동일) */
export const CATEGORY_NAME_MAX = 10;
/** 검색 필터(PostgREST or())를 깨뜨리는 문자 — DB rename_category와 동일 */
const FORBIDDEN = /[,()*%\\"{}#]/;

/** DB에서 읽은 값 → 항상 6개 · 6번은 '업무'인 목록으로 정규화 (잘못된 값이면 기본값) */
export function normalizeLabels(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== CATEGORY_COUNT) return [...DEFAULT_CATEGORIES];
  const labels = raw.map((v, i) => (typeof v === "string" && v.trim() ? v.trim() : DEFAULT_CATEGORIES[i]));
  labels[WORK_SLOT] = DEFAULT_CATEGORIES[WORK_SLOT];
  return new Set(labels).size === CATEGORY_COUNT ? labels : [...DEFAULT_CATEGORIES];
}

/**
 * 1~5번 슬롯 이름 변경 유효성 검사. 문제가 없으면 null, 있으면 오류 문구.
 * @param slot 0-based (0~4)
 */
export function validateCategoryName(labels: string[], slot: number, name: string): string | null {
  if (slot < 0 || slot >= WORK_SLOT) return "6번 '업무' 태그는 수정할 수 없습니다.";
  const v = name.trim();
  if (!v) return "태그 이름을 입력해 주세요.";
  if (v.length > CATEGORY_NAME_MAX) return `${CATEGORY_NAME_MAX}자 이하로 입력해 주세요.`;
  if (FORBIDDEN.test(v)) return '사용할 수 없는 문자가 있습니다. ( , ( ) * % \\ " { } # 제외)';
  if (labels.some((l, i) => i !== slot && l === v)) return "이미 사용 중인 태그 이름입니다.";
  return null;
}
