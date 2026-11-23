import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CATEGORY, DEFAULT_TAG, type Category } from "./types";

/**
 * 새 할 일 제목 → 과거 이력(todos 전체 기간, DB 직접 조회)에서 1차·2차 태그 쌍 추론.
 * 브라우저(일반 추가 폼)와 서버(AI create_todos) 양쪽에서 같은 규칙으로 사용.
 *
 * 매칭 규칙 (오분류 방지)
 *  1) 제목이 정확히 일치하는 가장 최근 이력
 *  2) 일반 동작어(작성·검토·정리…)를 뺀 핵심 키워드(2글자 이상)가 포함된 이력 중
 *     맞은 키워드 수가 가장 많고, 같으면 가장 최근인 것
 *  3) 없으면 기본값 ('업무' / '기타업무') — 추가 AI 호출 없이 즉시 폴백
 */

export type InferredTags = {
  category: Category;
  tags: string[];
  source: "exact" | "keyword" | "default";
  /** 근거가 된 과거 일정 제목 (default면 없음) */
  matchedTitle?: string;
};

/** 제목 끝에 붙는 일반 동작어 — 업무를 구분하는 단서가 아니므로 키워드에서 제외 */
const GENERIC_WORDS = [
  "작성",
  "검토",
  "정리",
  "확인",
  "준비",
  "보고",
  "수정",
  "발송",
  "제출",
  "공유",
  "요청",
  "진행",
  "처리",
  "완료",
  "업데이트",
];
/** 단어 끝 조사 (남는 부분이 2글자 이상일 때만 제거) */
const PARTICLES = ["을", "를", "은", "는", "이", "가", "의", "와", "과", "에", "및"];
/** 날짜·숫자 토큰 (11월, 3차, 2026 등)은 업무 단서가 아님 */
const NUMERIC = /^\d+(년|월|일|주|주차|차|시|분|회)?$/;
/** PostgREST or() 문법을 깨뜨리는 문자 — lib/search.ts와 동일 기준 */
const UNSAFE = /[,()*%\\"{}]/g;

const MAX_KEYWORDS = 5;
const KEYWORD_SCAN_LIMIT = 50;

export const defaultTags = (): InferredTags => ({ category: DEFAULT_CATEGORY, tags: [DEFAULT_TAG], source: "default" });

function stripEnd(word: string, endings: string[]): string {
  for (const e of endings) {
    if (word.endsWith(e) && word.length - e.length >= 2) return word.slice(0, -e.length);
  }
  return word;
}

/** 제목 → 핵심 키워드 (긴 것 우선, 최대 5개) */
export function titleKeywords(title: string): string[] {
  const out = new Set<string>();
  for (const raw of title.replace(UNSAFE, " ").split(/[^\p{L}\p{N}]+/u)) {
    let w = stripEnd(raw.trim(), PARTICLES);
    if (GENERIC_WORDS.includes(w)) continue;
    // '보고서작성' → '보고서', '자료준비' → '자료' (남는 부분이 2글자 이상일 때만)
    w = stripEnd(w, GENERIC_WORDS);
    if (w.length < 2 || GENERIC_WORDS.includes(w) || NUMERIC.test(w)) continue;
    out.add(w);
  }
  return [...out].sort((a, b) => b.length - a.length).slice(0, MAX_KEYWORDS);
}

type HistoryRow = { title: string; category: string | null; tags: string[] | null; created_at: string };

function toResult(row: HistoryRow, source: "exact" | "keyword", categories?: readonly string[]): InferredTags {
  const tags = (row.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const category = row.category?.trim() ?? "";
  return {
    // 1차 태그 이름이 그 사이 바뀌었으면(현재 목록에 없음) 기본값으로
    category: category && (!categories || categories.includes(category)) ? category : DEFAULT_CATEGORY,
    tags: tags.length ? tags : [DEFAULT_TAG],
    source,
    matchedTitle: row.title,
  };
}

/**
 * @param categories 현재 사용자의 1차 태그 이름 목록 (주면 목록에 없는 과거 값은 기본값으로 바꿈)
 * @param excludeIds 방금 만든 일정 등 비교에서 뺄 id
 */
export async function inferTodoTags(
  sb: SupabaseClient,
  userId: string,
  title: string,
  opts: { categories?: readonly string[]; excludeIds?: string[] } = {},
): Promise<InferredTags> {
  const t = title.trim();
  if (!t || !userId) return defaultTags();
  const cols = "id, title, category, tags, created_at";
  const notExcluded = (r: { id: string }) => !opts.excludeIds?.includes(r.id);

  try {
    // 1) 제목 정확히 일치
    const exact = await sb
      .from("todos")
      .select(cols)
      .eq("user_id", userId)
      .eq("title", t)
      .order("created_at", { ascending: false })
      .limit(5);
    const exactRow = ((exact.data ?? []) as (HistoryRow & { id: string })[]).find(notExcluded);
    if (!exact.error && exactRow) return toResult(exactRow, "exact", opts.categories);

    // 2) 핵심 키워드 포함 (최근 50건 중 맞은 키워드 수 → 최신순)
    const keywords = titleKeywords(t);
    if (!keywords.length) return defaultTags();
    const { data, error } = await sb
      .from("todos")
      .select(cols)
      .eq("user_id", userId)
      .or(keywords.map((k) => `title.ilike.%${k}%`).join(","))
      .order("created_at", { ascending: false })
      .limit(KEYWORD_SCAN_LIMIT);
    if (error) return defaultTags();

    let best: { row: HistoryRow; score: number } | null = null;
    for (const row of ((data ?? []) as (HistoryRow & { id: string })[]).filter(notExcluded)) {
      const lower = row.title.toLowerCase();
      const score = keywords.filter((k) => lower.includes(k.toLowerCase())).length;
      // 최신순으로 순회하므로 점수가 '더 높을 때만' 교체 → 동점이면 최신 유지
      if (score > 0 && (!best || score > best.score)) best = { row, score };
    }
    return best ? toResult(best.row, "keyword", opts.categories) : defaultTags();
  } catch {
    return defaultTags();
  }
}

/** 사용자가 직접 고르지 않은 값인지 (폼은 비워 두면 기본값을 채우므로 기본값 = 미선택으로 봄) */
export const isDefaultCategory = (c: Category | null | undefined) => !c || c === DEFAULT_CATEGORY;
export const isDefaultTags = (tags: string[] | null | undefined) => {
  const clean = (tags ?? []).map((t) => t.trim()).filter(Boolean);
  return !clean.length || (clean.length === 1 && clean[0] === DEFAULT_TAG);
};

/**
 * 등록 직전 최종 1차·2차 태그 결정. 직접 고른 값은 그대로 두고, 고르지 않은(기본값) 쪽만 이력으로 채움.
 * 둘 다 직접 골랐으면 DB 조회 없이 바로 반환.
 */
export async function resolveTodoTags(
  sb: SupabaseClient,
  userId: string,
  title: string,
  manual: { category?: Category | null; tags?: string[] | null },
  opts: { categories?: readonly string[]; excludeIds?: string[] } = {},
): Promise<{ category: Category; tags: string[]; source: InferredTags["source"] | "manual" }> {
  const keepCategory = !isDefaultCategory(manual.category);
  const keepTags = !isDefaultTags(manual.tags);
  const manualTags = (manual.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (keepCategory && keepTags) return { category: manual.category!, tags: manualTags, source: "manual" };

  const inferred = await inferTodoTags(sb, userId, title, opts);
  return {
    category: keepCategory ? manual.category! : inferred.category,
    tags: keepTags ? manualTags : inferred.tags,
    source: inferred.source,
  };
}
