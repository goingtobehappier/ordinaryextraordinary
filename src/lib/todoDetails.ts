import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Subtask } from "./types";

/** todo 하나당 1행: 세부 메모 + 하위 작업 */
export type Detail = { memo: string; subtasks: Subtask[] };

export type DetailResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PostgrestError; message: string };

type DbError = Pick<PostgrestError, "code" | "message"> & Partial<PostgrestError>;

// ───────────────────────────── 정규화 ─────────────────────────────

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** jsonb [{id,text,done}] 또는 레거시 형태(문자열 배열, title/completed 키, JSON 문자열)를 공통 형태로 */
export function toSubtasks(raw: unknown): Subtask[] {
  const arr = typeof raw === "string" ? safeJson(raw) : raw;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((e, i) =>
      typeof e === "string"
        ? { id: String(i), text: e, done: false }
        : {
            id: String(e?.id ?? i),
            text: String(e?.text ?? e?.title ?? e?.name ?? ""),
            done: Boolean(e?.done ?? e?.completed),
          },
    )
    .filter((s) => s.text);
}

// ───────────────────────────── 에러 분류 ─────────────────────────────

/** subtasks 컬럼이 DB(또는 PostgREST 스키마 캐시)에 없음 */
export const isMissingColumn = (e: DbError | null | undefined, column?: string) =>
  !!e &&
  (e.code === "42703" || e.code === "PGRST204") &&
  (!column || `${e.message} ${e.details ?? ""}`.includes(column));

/** todo_id에 unique 제약이 없어 ON CONFLICT(upsert)를 쓸 수 없음 */
const isNoConflictTarget = (e: DbError) => e.code === "42P10";

/** 세션 만료·RLS 거부 → 토큰 갱신 후 한 번 재시도할 가치가 있음 */
const isAuthError = (e: DbError) =>
  e.code === "42501" || e.code === "PGRST301" || e.code === "PGRST303" || /jwt/i.test(e.message);

/** 사용자에게 보여줄 원인 설명 */
export function describeDetailError(e: DbError): string {
  switch (e.code) {
    case "42501":
      return "권한이 없습니다(RLS). 다시 로그인하거나 과업 소유자를 확인해 주세요.";
    case "PGRST301":
    case "PGRST303":
      return "로그인 세션이 만료되었습니다. 새로고침 후 다시 시도해 주세요.";
    case "23503":
      return "원본 과업이 삭제되어 저장할 수 없습니다.";
    case "23502":
      return "DB 필수 컬럼 제약에 걸렸습니다. supabase/migrations/006_todo_details_fix.sql을 실행해 주세요.";
    case "42P10":
    case "42703":
    case "PGRST204":
      return "DB 스키마가 앱과 맞지 않습니다. supabase/migrations/006_todo_details_fix.sql을 실행해 주세요.";
    case "PGRST116":
      return "같은 과업의 상세 행이 중복되어 있습니다. 006 마이그레이션으로 정리해 주세요.";
  }
  if (/failed to fetch|network/i.test(e.message)) return "네트워크 연결을 확인해 주세요.";
  return e.message || "알 수 없는 오류";
}

/** 콘솔에 보기 좋게 남기기 (접힌 그룹 + 표) */
export function logDetailError(action: string, e: DbError, context: Record<string, unknown>) {
  console.groupCollapsed(
    `%c todo_details %c ${action} 실패 %c ${e.code ?? ""} ${e.message}`,
    "background:#c4271d;color:#fff;border-radius:4px;padding:1px 4px;font-weight:600",
    "color:#c4271d;font-weight:600",
    "color:#888",
  );
  console.table({
    code: e.code ?? "",
    message: e.message,
    details: e.details ?? "",
    hint: e.hint ?? "",
    원인: describeDetailError(e),
  });
  console.log("context", context);
  console.groupEnd();
}

const toPostgrestError = (e: unknown): PostgrestError => {
  const err = e as Partial<PostgrestError> & { name?: string };
  return {
    code: err?.code ?? "FETCH_ERROR",
    message: err?.message ?? String(e),
    details: err?.details ?? "",
    hint: err?.hint ?? "",
    name: "PostgrestError",
  } as PostgrestError;
};

const fail = <T,>(error: PostgrestError): DetailResult<T> => ({ ok: false, error, message: describeDetailError(error) });

// ───────────────────────────── 조회 ─────────────────────────────

/** 상세 조회. RLS가 본인 행만 돌려주므로 user_id 필터 없이 todo_id로만 조회 (userId 미확정 시 잘못된 uuid 오류 방지) */
export async function loadTodoDetail(sb: SupabaseClient, todoId: string): Promise<DetailResult<Detail>> {
  try {
    const query = (cols: string) =>
      sb.from("todo_details").select(cols).eq("todo_id", todoId).limit(1);
    let { data, error } = await query("memo, subtasks");
    // 레거시 스키마(sub_tasks)만 있는 경우
    if (isMissingColumn(error, "subtasks")) ({ data, error } = await query("memo, subtasks:sub_tasks"));
    if (error) {
      logDetailError("조회", error, { todoId });
      return fail(error);
    }
    const row = (data?.[0] ?? null) as { memo?: string | null; subtasks?: unknown } | null;
    return { ok: true, data: { memo: row?.memo ?? "", subtasks: toSubtasks(row?.subtasks) } };
  } catch (e) {
    const error = toPostgrestError(e);
    logDetailError("조회", error, { todoId });
    return fail(error);
  }
}

// ───────────────────────────── 저장 ─────────────────────────────

type Row = { todo_id: string; user_id?: string; memo: string; [k: string]: unknown };

/** upsert → (unique 제약 없음) update 후 없으면 insert */
async function write(sb: SupabaseClient, row: Row) {
  const up = await sb.from("todo_details").upsert(row, { onConflict: "todo_id" });
  if (!up.error || !isNoConflictTarget(up.error)) return up.error;

  const { todo_id, ...patch } = row;
  const upd = await sb.from("todo_details").update(patch).eq("todo_id", todo_id).select("todo_id");
  if (upd.error) return upd.error;
  if (upd.data?.length) return null;
  return (await sb.from("todo_details").insert(row)).error;
}

/**
 * 상세 저장. 실패 원인별로 자동 복구를 시도함:
 *  - user_id는 스토어 값이 아닌 현재 세션 사용자로 채움 (RLS with check 불일치 방지)
 *  - todo_id unique 제약이 없으면 update/insert로 대체
 *  - subtasks 컬럼이 없으면 레거시 sub_tasks 컬럼에 저장
 *  - 세션 만료/RLS 거부면 토큰을 갱신하고 한 번 재시도
 */
export async function saveTodoDetail(
  sb: SupabaseClient,
  todoId: string,
  detail: Detail,
  fallbackUserId: string | null,
): Promise<DetailResult<null>> {
  const context = { todoId, subtasks: detail.subtasks.length, memoLength: detail.memo.length };
  try {
    const attempt = async () => {
      const { data } = await sb.auth.getSession();
      const userId = data.session?.user.id ?? fallbackUserId ?? undefined;
      const base: Row = { todo_id: todoId, memo: detail.memo, ...(userId ? { user_id: userId } : {}) };

      let error = await write(sb, { ...base, subtasks: detail.subtasks });
      if (error && isMissingColumn(error, "subtasks")) {
        error = await write(sb, { ...base, sub_tasks: detail.subtasks });
      }
      return error;
    };

    let error = await attempt();
    if (error && isAuthError(error)) {
      await sb.auth.refreshSession();
      error = await attempt();
    }
    if (error) {
      logDetailError("저장", error, context);
      return fail(error);
    }
    return { ok: true, data: null };
  } catch (e) {
    const error = toPostgrestError(e);
    logDetailError("저장", error, context);
    return fail(error);
  }
}
