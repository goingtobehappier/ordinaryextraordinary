import { isCategory } from "./types";

/**
 * 검색어 → PostgREST or() 필터 (제목 부분일치 · 2차 태그 일치 · 1차 태그 일치).
 * 검색어가 비어 있으면 null (= 조건 없음).
 */
export function searchFilter(term: string): string | null {
  // or() 문법을 깨뜨리는 문자 제거
  const safe = term.replace(/[,()*%\\"{}]/g, " ").trim();
  if (!safe) return null;
  const tag = safe.replace(/^#/, "");
  return [
    `title.ilike.%${safe}%`,
    `tags.cs.{"${tag}"}`,
    ...(isCategory(tag) ? [`category.eq.${tag}`] : []),
  ].join(",");
}
