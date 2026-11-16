/**
 * Supabase(PostgREST) 페이지네이션 조회.
 *
 * `.limit(n)`만으로는 서버의 max-rows 설정(호스팅 기본 1000행)에서 조용히 잘리므로,
 * `.range(from, to)`로 나눠 받아 이어 붙인다. 서버 상한이 pageSize보다 작아도 누락되지 않도록
 * 실제로 받은 건수만큼 offset을 옮기고, 빈 페이지가 오면 끝으로 본다.
 * 페이지 경계에서 행이 겹치거나 빠지지 않도록 build는 고유 키(id 등)까지 포함해 정렬해야 한다.
 */
type PageError = { message: string; code: string };
type PageResult = PromiseLike<{ data: unknown; error: PageError | null }>;

/** T: 한 행의 형태 (select 문자열을 동적으로 만들면 타입 추론이 안 되므로 호출 측에서 지정) */
export async function fetchAllPages<T = Record<string, unknown>>(
  build: (from: number, to: number) => PageResult,
  { pageSize = 5000, max = Infinity }: { pageSize?: number; max?: number } = {},
): Promise<{ data: T[]; error: PageError | null; truncated: boolean }> {
  const rows: T[] = [];
  while (rows.length < max) {
    const size = Math.min(pageSize, max - rows.length);
    const { data, error } = await build(rows.length, rows.length + size - 1);
    if (error) return { data: rows, error, truncated: false };
    const page = (data ?? []) as T[];
    if (!page.length) return { data: rows, error: null, truncated: false };
    rows.push(...page);
  }
  return { data: rows, error: null, truncated: true };
}
