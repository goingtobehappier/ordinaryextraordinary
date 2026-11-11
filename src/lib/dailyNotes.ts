import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily Memopad 서버 저장소 접근.
 * 실제 DB 스키마가 앱과 달라도(레거시 테이블·컬럼, unique 제약 누락) 오류 코드를 보고 맞춰서 재시도하고,
 * 알아낸 스키마는 세션 동안 기억함. 원인을 콘솔에 남기고 사용자용 메시지를 돌려줌.
 *
 *  - 테이블 없음(404 · PGRST205 · 42P01)      → daily_notes ↔ daily_memos
 *  - 날짜 컬럼 없음(PGRST204 · 42703)          → date → note_date → memo_date
 *  - updated_at 없음                           → 버전 없이 동작
 *  - unique 제약 없음(42P10, upsert 불가)      → update 후 없으면 insert
 *  - 레거시 날짜 컬럼 NOT NULL(23502)          → 해당 컬럼도 같은 날짜로 채움
 *  - 세션 만료(401 · PGRST301 · JWT)           → 토큰 갱신 후 1회 재시도
 */

const TABLES = ["daily_notes", "daily_memos"] as const;
const DATE_COLS = ["date", "note_date", "memo_date"] as const;
type Table = (typeof TABLES)[number];
type DateCol = (typeof DATE_COLS)[number];

type Schema = {
  table: Table;
  dateCol: DateCol;
  hasUpdatedAt: boolean;
  /** (user_id, 날짜) unique 제약이 있어 upsert 가능 */
  upsertOk: boolean;
  /** NOT NULL이라 함께 채워야 하는 다른 날짜 컬럼 */
  extraDateCols: string[];
};

const schema: Schema = { table: "daily_notes", dateCol: "date", hasUpdatedAt: true, upsertOk: true, extraDateCols: [] };
const triedTables = new Set<Table>();
const triedDateCols = new Set<DateCol>();

export type DbError = { code?: string; message: string; details?: string | null; hint?: string | null; status?: number };
export type NoteRow = { content: string; updated_at: string | null };
export type Result<T> = { ok: true; data: T } | { ok: false; error: DbError; message: string };

const MAX_ATTEMPTS = 8;

const text = (e: DbError) => `${e.message} ${e.details ?? ""} ${e.hint ?? ""}`;
const isMissingTable = (e: DbError) => e.code === "PGRST205" || e.code === "42P01" || e.status === 404;
const isMissingColumn = (e: DbError, col: string) =>
  (e.code === "PGRST204" || e.code === "42703") && new RegExp(`['".]${col}['"\\s]|\\b${col}\\b does not exist`).test(text(e));
const isAuth = (e: DbError) =>
  e.code === "PGRST301" || e.code === "PGRST303" || e.code === "NO_SESSION" || e.status === 401 || /jwt/i.test(e.message);

/** 오류를 보고 스키마 추정을 고침. 고쳤으면 true (재시도 가치 있음) */
function adapt(e: DbError): boolean {
  if (isMissingTable(e)) {
    triedTables.add(schema.table);
    const next = TABLES.find((t) => !triedTables.has(t));
    if (!next) return false;
    schema.table = next;
    return true;
  }
  if (isMissingColumn(e, schema.dateCol)) {
    triedDateCols.add(schema.dateCol);
    const next = DATE_COLS.find((c) => !triedDateCols.has(c));
    if (!next) return false;
    schema.dateCol = next;
    return true;
  }
  if (schema.hasUpdatedAt && isMissingColumn(e, "updated_at")) {
    schema.hasUpdatedAt = false;
    return true;
  }
  const extra = schema.extraDateCols.find((c) => isMissingColumn(e, c));
  if (extra) {
    schema.extraDateCols = schema.extraDateCols.filter((c) => c !== extra);
    return true;
  }
  if (e.code === "42P10" && schema.upsertOk) {
    schema.upsertOk = false;
    return true;
  }
  if (e.code === "23502") {
    // null value in column "note_date" ... → 날짜 계열 컬럼이면 같은 날짜로 채워서 재시도
    const col = /column "([^"]+)"/.exec(e.message)?.[1];
    if (col && /date/i.test(col) && col !== schema.dateCol && !schema.extraDateCols.includes(col)) {
      schema.extraDateCols = [...schema.extraDateCols, col];
      return true;
    }
  }
  return false;
}

/** 사용자에게 보여줄 원인 */
export function describeNoteError(e: DbError): string {
  if (e.code === "NO_SESSION") return "로그인 세션이 없습니다. 다시 로그인하면 자동으로 동기화됩니다.";
  if (isAuth(e)) return "로그인 세션이 만료되었습니다. 새로고침하면 자동으로 동기화됩니다.";
  if (e.code === "42501") return "권한이 없습니다(RLS). 010 마이그레이션을 실행해 주세요.";
  if (isMissingTable(e)) return "daily_notes 테이블이 없습니다. supabase/migrations/010_daily_notes_fix.sql을 실행해 주세요.";
  if (["PGRST204", "42703", "42P10", "23502"].includes(e.code ?? ""))
    return `DB 구조가 앱과 다릅니다. supabase/migrations/010_daily_notes_fix.sql을 실행해 주세요. (${e.code})`;
  if (e.code === "FETCH_ERROR" || /fetch|network/i.test(e.message)) return "네트워크에 연결할 수 없습니다.";
  return e.message || "알 수 없는 오류";
}

const lastLogged = new Set<string>();
function logOnce(action: string, e: DbError, context: Record<string, unknown>) {
  const key = `${action}:${e.code}:${e.message}`;
  if (lastLogged.has(key)) return;
  lastLogged.add(key);
  console.groupCollapsed(`%c memopad %c ${action} 실패 %c ${e.code ?? ""} ${e.message}`,
    "background:#b86b00;color:#fff;border-radius:4px;padding:1px 4px;font-weight:600",
    "color:#b86b00;font-weight:600",
    "color:#888");
  console.table({ code: e.code ?? "", status: e.status ?? "", message: e.message, details: e.details ?? "", hint: e.hint ?? "", 원인: describeNoteError(e) });
  console.log("schema", { ...schema }, "context", context);
  console.groupEnd();
}

const asDbError = (e: unknown): DbError => {
  const err = e as Partial<DbError> & { name?: string };
  return { code: err?.code ?? "FETCH_ERROR", message: err?.message ?? String(e), details: err?.details ?? null };
};

type Raw = { data: unknown; error: (DbError & { code: string }) | null; status?: number };
const withStatus = (r: Raw): DbError | null => (r.error ? { ...r.error, status: r.status } : null);

const columns = () => (schema.hasUpdatedAt ? "content, updated_at" : "content");
const toRow = (d: unknown): NoteRow | null => {
  const r = (Array.isArray(d) ? d[0] : d) as { content?: string | null; updated_at?: string | null } | null | undefined;
  return r ? { content: r.content ?? "", updated_at: r.updated_at ?? null } : null;
};

/** 오류에 맞춰 스키마를 고쳐 가며 실행. 세션 오류는 토큰 갱신 후 한 번 더 */
async function run<T>(sb: SupabaseClient, action: string, context: Record<string, unknown>, attempt: () => Promise<{ data: T } | { error: DbError }>): Promise<Result<T>> {
  let refreshed = false;
  let last: DbError = { message: "unknown" };
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let res: { data: T } | { error: DbError };
    try {
      res = await attempt();
    } catch (e) {
      res = { error: asDbError(e) };
    }
    if ("data" in res) return { ok: true, data: res.data };
    last = res.error;
    if (adapt(last)) continue;
    if (isAuth(last) && !refreshed) {
      refreshed = true;
      const { error } = await sb.auth.refreshSession();
      if (!error) continue;
    }
    break;
  }
  logOnce(action, last, context);
  return { ok: false, error: last, message: describeNoteError(last) };
}

/** 해당 날짜 노트 조회 (없으면 null) */
export function loadNote(sb: SupabaseClient, userId: string, date: string) {
  return run<NoteRow | null>(sb, "불러오기", { date }, async () => {
    let q = sb.from(schema.table).select(columns()).eq("user_id", userId).eq(schema.dateCol, date);
    // 같은 날짜 행이 여러 개여도(unique 없음) 최신 1개만
    if (schema.hasUpdatedAt) q = q.order("updated_at", { ascending: false });
    const r = (await q.limit(1)) as unknown as Raw;
    const error = withStatus(r);
    return error ? { error } : { data: toRow(r.data) };
  });
}

/** 저장 (upsert, 불가하면 update → insert). 세션이 없으면 NO_SESSION 오류 */
export function saveNote(sb: SupabaseClient, fallbackUserId: string, date: string, content: string) {
  return run<NoteRow>(sb, "저장", { date, length: content.length }, async () => {
    const { data: auth } = await sb.auth.getSession();
    const userId = auth.session?.user.id ?? null;
    if (!userId) return { error: { code: "NO_SESSION", message: "no session" } };
    if (userId !== fallbackUserId) console.warn("[memopad] 세션 사용자와 화면 사용자가 다릅니다", { session: userId, prop: fallbackUserId });

    const payload: Record<string, unknown> = { user_id: userId, [schema.dateCol]: date, content };
    for (const c of schema.extraDateCols) payload[c] = date;

    if (schema.upsertOk) {
      const r = (await sb
        .from(schema.table)
        .upsert(payload, { onConflict: `user_id,${schema.dateCol}` })
        .select(columns())
        .limit(1)) as unknown as Raw;
      const error = withStatus(r);
      return error ? { error } : { data: toRow(r.data) ?? { content, updated_at: null } };
    }

    const u = (await sb
      .from(schema.table)
      .update({ content, ...Object.fromEntries(schema.extraDateCols.map((c) => [c, date])) })
      .eq("user_id", userId)
      .eq(schema.dateCol, date)
      .select(columns())) as unknown as Raw;
    const uErr = withStatus(u);
    if (uErr) return { error: uErr };
    const updated = toRow(u.data);
    if (updated) return { data: updated };

    const ins = (await sb.from(schema.table).insert(payload).select(columns()).limit(1)) as unknown as Raw;
    const iErr = withStatus(ins);
    return iErr ? { error: iErr } : { data: toRow(ins.data) ?? { content, updated_at: null } };
  });
}
