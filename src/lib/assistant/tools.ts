import type { FunctionDeclaration } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLabels } from "@/lib/categories";
import { resolveTodoTags } from "@/lib/tagInference";
import { DEFAULT_CATEGORY, DEFAULT_TAG, type Repeat } from "@/lib/types";

/** O.E. Buddy 도구 실행 결과 — Gemini functionResponse.response로 그대로 전달됨 */
export type ToolResult = Record<string, unknown>;

export type ToolContext = {
  supabase: SupabaseClient;
  userId: string;
  /** KST 기준 오늘 (YYYY-MM-DD) */
  today: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const REPEATS: Repeat[] = ["none", "daily", "weekdays", "weekly", "monthly"];

const SEARCH_LIMIT = 30;
const CREATE_LIMIT = 20;
const CARRY_LIMIT = 100;
const TAG_LIMIT = 20;
const TAG_MAX_LEN = 40;

const TODO_COLUMNS =
  "id, title, category, date, start_time, end_time, tags, repeat, completed_dates, ai_tags, used_tools, retrospective_memo";

type TodoRow = {
  id: string;
  title: string;
  category: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  tags: string[] | null;
  repeat: string;
  completed_dates: string[] | null;
  ai_tags: string[] | null;
  used_tools: string[] | null;
  retrospective_memo: string | null;
};

// ───────────────────────────── 입력 정리 ─────────────────────────────

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  return ISO_DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
const hhmm = (v: unknown): string | null => {
  const s = str(v);
  return HHMM.test(s) ? s.slice(0, 5) : null;
};

/** PostgREST 필터(or(), 배열 리터럴)를 깨뜨리는 문자 제거 — lib/search.ts와 동일 기준 */
const safeTerm = (v: unknown) => str(v).replace(/[,()*%\\"{}]/g, " ").trim();

/** 태그 배열 정리: 문자열만, '#' 제거, 중복 제거, 개수·길이 제한 */
function tagList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const item of v) {
    const t = safeTerm(item).replace(/^#+/, "").slice(0, TAG_MAX_LEN).trim();
    if (t) out.add(t);
    if (out.size >= TAG_LIMIT) break;
  }
  return [...out];
}

const isDone = (t: Pick<TodoRow, "date" | "completed_dates">) => (t.completed_dates ?? []).includes(t.date);

/** 검색 결과 한 건에 담는 세부 메모 최대 길이 (응답 컨텍스트 과다 방지) */
const MEMO_PREVIEW_MAX = 1500;

/** 모델에게 돌려줄 일정 요약 (불필요한 필드 제외). memo = 세부 메모(todo_details.memo) */
function view(t: TodoRow, memo?: string | null) {
  const m = memo?.trim();
  return {
    id: t.id,
    title: t.title,
    date: t.date,
    start_time: t.start_time?.slice(0, 5) ?? null,
    end_time: t.end_time?.slice(0, 5) ?? null,
    category: t.category,
    tags: t.tags ?? [],
    repeat: t.repeat,
    done: t.repeat === "none" ? isDone(t) : undefined,
    // 반복 일정은 날짜별 완료 기록
    ...(t.repeat !== "none" ? { completed_dates: t.completed_dates ?? [] } : {}),
    ...(m !== undefined ? { memo: m ? (m.length > MEMO_PREVIEW_MAX ? `${m.slice(0, MEMO_PREVIEW_MAX)}…(생략)` : m) : "" } : {}),
    // 세부 메모로 일원화하기 전 별도 컬럼에 남은 기록 (있을 때만)
    ...(t.retrospective_memo?.trim() ? { legacy_retrospective: t.retrospective_memo.trim() } : {}),
    ...(t.used_tools?.length ? { legacy_used_tools: t.used_tools } : {}),
  };
}

/** 일정 id 목록 → 세부 메모 (RLS로 본인 행만) */
async function loadMemos(ctx: ToolContext, ids: string[]): Promise<Map<string, string>> {
  const memos = new Map<string, string>();
  if (!ids.length) return memos;
  const { data, error } = await ctx.supabase.from("todo_details").select("todo_id, memo").in("todo_id", ids);
  if (error) {
    console.error("[assistant] loadMemos failed", error.message);
    return memos;
  }
  for (const r of (data ?? []) as { todo_id: string; memo: string | null }[]) memos.set(r.todo_id, r.memo ?? "");
  return memos;
}

async function loadCategories(ctx: ToolContext): Promise<string[]> {
  const { data } = await ctx.supabase.from("user_categories").select("labels").eq("user_id", ctx.userId).maybeSingle();
  return normalizeLabels(data?.labels);
}

// ───────────────────────────── 도구 정의 ─────────────────────────────

const UPDATE_LIMIT = 30;
const DELETE_LIMIT = 50;
/** 이 건수 이상 삭제는 사용자 확인(confirmed=true) 없이는 실행하지 않음 */
const DELETE_CONFIRM_AT = 3;
const TITLE_MAX = 300;
const MEMO_MAX = 10_000;

/** 대상 일정 지정 (update_todos 항목·update_todo_memo 공통) */
const TARGET_PROPS = {
  todoId: { type: "string", description: "일정 id (search_todos 결과의 id). 가능하면 항상 id로 지정" },
  date: { type: "string", description: "일정 날짜 YYYY-MM-DD (todoId가 없을 때)" },
  titleQuery: { type: "string", description: "제목 일부 (todoId가 없을 때)" },
};

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "search_todos",
    description:
      "사용자의 일정(todos)을 전체 기간(과거·미래)에서 조회한다. 각 일정의 id·완료 여부·세부 메모(memo: 업무 재료·회고·사용 도구·노하우)를 함께 돌려준다. 수정·삭제 전에 대상 id를 확인할 때, 작년 유사 업무 레퍼런스·과거 회고 확인, 특정 기간 일정 확인에 사용. 최신 날짜순 최대 30건.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "제목·2차 태그·세부 메모 내용에서 찾을 키워드 (부분 일치)" },
        startDate: { type: "string", description: "조회 시작일 YYYY-MM-DD (포함)" },
        endDate: { type: "string", description: "조회 종료일 YYYY-MM-DD (포함)" },
        onlyIncomplete: { type: "boolean", description: "true면 미완료(반복 없는) 일정만" },
        limit: { type: "integer", description: "최대 건수 (1~30, 기본 30)" },
      },
    },
  },
  {
    name: "create_todos",
    description:
      "일정을 한 건 또는 여러 건 한 번에 등록한다. 날짜·시간·세부 메모까지 한 번에 넣을 수 있다. 날짜가 모호하면 오늘 기준으로 계산한 YYYY-MM-DD를 넣는다. category(1차 태그)와 tags(2차 태그)는 사용자가 직접 말한 경우에만 넣고, 아니면 반드시 생략한다 — 생략하면 서버가 과거 같은·유사한 업무 이력의 태그를 자동 적용하고, 이력이 없으면 기본값('업무'/'기타업무')을 쓴다. 결과의 tagSource로 태그 근거(manual/exact/keyword/default)를 알 수 있다.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "등록할 일정 목록 (최대 20건)",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "일정 제목" },
              date: { type: "string", description: "YYYY-MM-DD" },
              start_time: { type: "string", description: "HH:MM (24시간). 시간 미지정이면 생략" },
              end_time: { type: "string", description: "HH:MM (24시간). start_time이 있을 때만" },
              category: { type: "string", description: "1차 태그 — 사용자가 명시했을 때만 (예: 일정, 미팅, 보고, 마감, 회의, 업무)" },
              tags: { type: "array", items: { type: "string" }, description: "2차 태그 — 사용자가 명시했을 때만" },
              repeat: { type: "string", enum: REPEATS, description: "반복 (기본 none)" },
              memo: { type: "string", description: "세부 메모 (사용자가 메모 내용을 함께 말했을 때만)" },
            },
            required: ["title", "date"],
          },
        },
      },
      required: ["todos"],
    },
  },
  {
    name: "update_todos",
    description:
      "기존 일정의 속성을 수정한다(여러 건 가능). 제목 변경, 날짜 이동, 시작·종료 시간 지정·변경, 시간 지정 해제(clearTime=true → 시간 미지정 할 일), 완료 체크·해제(done), 1차 태그(category)·2차 태그(tags 전체 교체 / addTags / removeTags) 변경, 반복 설정 변경을 지원한다. 사용자가 요청한 속성만 넣고 나머지는 생략한다(생략한 속성은 그대로 유지). 반복 일정의 완료는 occurrenceDate(해당 날짜)에 기록된다.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          description: `수정할 일정 목록 (최대 ${UPDATE_LIMIT}건)`,
          items: {
            type: "object",
            properties: {
              ...TARGET_PROPS,
              title: { type: "string", description: "새 제목" },
              newDate: { type: "string", description: "옮길 날짜 YYYY-MM-DD (반복 일정이면 시작일 변경)" },
              start_time: { type: "string", description: "새 시작 시간 HH:MM" },
              end_time: { type: "string", description: "새 종료 시간 HH:MM (시작 시간이 있어야 함)" },
              clearTime: { type: "boolean", description: "true면 시작·종료 시간을 모두 지워 시간 미지정 할 일로" },
              clearEndTime: { type: "boolean", description: "true면 종료 시간만 지움" },
              done: { type: "boolean", description: "true = 완료 체크, false = 완료 해제" },
              occurrenceDate: { type: "string", description: "반복 일정의 완료를 기록할 날짜 YYYY-MM-DD (생략 시 오늘)" },
              category: { type: "string", description: "새 1차 태그 (사용자의 1차 태그 이름 중 하나)" },
              tags: { type: "array", items: { type: "string" }, description: "2차 태그 전체 교체" },
              addTags: { type: "array", items: { type: "string" }, description: "2차 태그 추가" },
              removeTags: { type: "array", items: { type: "string" }, description: "2차 태그 제거" },
              repeat: { type: "string", enum: REPEATS, description: "반복 설정 변경" },
            },
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "carry_over_todos",
    description:
      "과거 날짜의 미완료 일정(반복 없는 일정만)을 목표 날짜로 한꺼번에 옮긴다. sourceDate 하루, sourceDate~sourceEndDate 범위, 또는 allOverdue=true(오늘 이전 전체 미완료) 중 하나로 대상을 정한다. 특정 일정 1~2건 이동은 update_todos의 newDate를 써도 된다.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        targetDate: { type: "string", description: "옮길 날짜 YYYY-MM-DD" },
        sourceDate: { type: "string", description: "원래 날짜 YYYY-MM-DD (범위 시작)" },
        sourceEndDate: { type: "string", description: "범위 끝 YYYY-MM-DD (생략 시 sourceDate 하루)" },
        allOverdue: { type: "boolean", description: "true면 오늘 이전의 모든 미완료 일정" },
        todoIds: { type: "array", items: { type: "string" }, description: "특정 일정만 옮길 때 id 목록" },
      },
      required: ["targetDate"],
    },
  },
  {
    name: "update_todo_memo",
    description:
      "일정 상세 화면의 '세부 메모'(todo_details.memo)를 작성·수정·비운다. 일정의 모든 기록(업무 재료·참고 내용·회고·사용 도구·노하우)은 이 도구 하나로 세부 메모에 저장한다. mode: append(기본, 기존 내용 아래 줄바꿈 후 추가) / replace(사용자가 '덮어써줘·바꿔줘·고쳐줘'라고 할 때 전체 교체) / clear(사용자가 '메모 지워줘·비워줘'라고 할 때 비우기). 하위 작업은 건드리지 않는다.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        ...TARGET_PROPS,
        memo: {
          type: "string",
          description:
            "append·replace에 쓸 내용 (clear면 생략). 회고는 '[회고 YYYY-MM-DD] 내용', 사용 도구는 '사용 도구: A, B'처럼 머리말을 붙여 나중에 검색되게 쓴다.",
        },
        mode: { type: "string", enum: ["append", "replace", "clear"], description: "기본 append" },
      },
    },
  },
  {
    name: "delete_todos",
    description: `일정을 완전히 삭제한다(세부 메모·하위 작업 포함, 되돌릴 수 없음). 사용자가 삭제를 요청했을 때만 쓴다. 대상은 반드시 id로 지정한다(모르면 먼저 search_todos). ${DELETE_CONFIRM_AT}건 이상이면 confirmed 없이 호출할 경우 삭제하지 않고 대상 목록만 돌려주므로, 목록을 사용자에게 보여 확인받은 뒤 confirmed=true로 다시 호출한다.`,
    parametersJsonSchema: {
      type: "object",
      properties: {
        todoIds: { type: "array", items: { type: "string" }, description: `삭제할 일정 id 목록 (최대 ${DELETE_LIMIT}건)` },
        confirmed: { type: "boolean", description: `사용자가 삭제 대상 목록을 확인하고 동의했을 때만 true (${DELETE_CONFIRM_AT}건 이상일 때 필요)` },
      },
      required: ["todoIds"],
    },
  },
];

// ───────────────────────────── 공통 ─────────────────────────────

/** todoId 또는 date + titleQuery로 일정 1건 찾기. 못 찾거나 후보가 여럿이면 모델에게 돌려줄 결과를 반환 */
async function findTodo(args: Record<string, unknown>, ctx: ToolContext): Promise<{ todo: TodoRow } | { result: ToolResult }> {
  const todoId = str(args.todoId);
  if (todoId) {
    const { data, error } = await ctx.supabase
      .from("todos")
      .select(TODO_COLUMNS)
      .eq("user_id", ctx.userId)
      .eq("id", todoId)
      .maybeSingle();
    if (error) return { result: { error: error.message } };
    if (!data) return { result: { error: "해당 id의 일정을 찾지 못했습니다." } };
    return { todo: data as TodoRow };
  }

  const date = isoDate(args.date);
  const titleQuery = safeTerm(args.titleQuery);
  if (!date && !titleQuery) return { result: { error: "todoId 또는 date/titleQuery가 필요합니다." } };
  let q = ctx.supabase.from("todos").select(TODO_COLUMNS).eq("user_id", ctx.userId);
  if (date) q = q.eq("date", date);
  if (titleQuery) q = q.ilike("title", `%${titleQuery}%`);
  const { data, error } = await q.order("date", { ascending: false }).limit(10);
  if (error) return { result: { error: error.message } };
  const rows = (data ?? []) as TodoRow[];
  if (!rows.length) return { result: { error: "조건에 맞는 일정을 찾지 못했습니다." } };
  if (rows.length > 1) {
    return {
      result: { needsChoice: true, message: "후보가 여러 개입니다. 사용자에게 어떤 일정인지 확인하세요.", candidates: rows.map((t) => view(t)) },
    };
  }
  return { todo: rows[0] };
}

/** 세부 메모 쓰기: append(줄바꿈 후 추가) / replace(전체 교체) / clear(비우기). 하위 작업은 그대로 */
async function writeMemo(
  ctx: ToolContext,
  todoId: string,
  mode: "append" | "replace" | "clear",
  text: string,
): Promise<{ memo: string } | { error: string }> {
  const { data: existing, error: readErr } = await ctx.supabase.from("todo_details").select("memo").eq("todo_id", todoId).limit(1);
  if (readErr) return { error: `세부 메모 조회 실패: ${readErr.message}` };

  const hasRow = !!existing?.length;
  const before = ((existing?.[0] as { memo?: string | null } | undefined)?.memo ?? "").trimEnd();
  const memo = (mode === "clear" ? "" : mode === "replace" || !before ? text : `${before}\n${text}`).slice(0, MEMO_MAX);
  if (!hasRow && mode === "clear") return { memo: "" };

  // todo_id unique 제약 유무와 무관하게 동작하도록 update → 없으면 insert
  const { error } = hasRow
    ? await ctx.supabase.from("todo_details").update({ memo }).eq("todo_id", todoId)
    : await ctx.supabase.from("todo_details").insert({ todo_id: todoId, user_id: ctx.userId, memo });
  if (error) return { error: `세부 메모 저장 실패: ${error.message}` };
  return { memo };
}

// ───────────────────────────── 도구 실행 ─────────────────────────────

async function searchTodos(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(args.limit) || SEARCH_LIMIT, 1), SEARCH_LIMIT);
  const start = isoDate(args.startDate);
  const end = isoDate(args.endDate);
  const keyword = safeTerm(args.keyword).replace(/^#/, "");
  const onlyIncomplete = args.onlyIncomplete === true;

  // 세부 메모(todo_details.memo)에 키워드가 들어 있는 일정 id → 제목 검색과 OR로 묶음
  let memoIds: string[] = [];
  if (keyword) {
    const { data, error } = await ctx.supabase
      .from("todo_details")
      .select("todo_id")
      .ilike("memo", `%${keyword}%`)
      // id 목록이 요청 URL에 들어가므로 길이 제한 (uuid 100개 ≈ 3.7KB)
      .limit(100);
    if (error) console.error("[assistant] memo search failed", error.message);
    else memoIds = [...new Set(((data ?? []) as { todo_id: string }[]).map((r) => r.todo_id).filter(Boolean))];
  }

  let q = ctx.supabase.from("todos").select(TODO_COLUMNS).eq("user_id", ctx.userId);
  if (start) q = q.gte("date", start);
  if (end) q = q.lte("date", end);
  if (keyword) {
    q = q.or(
      [
        `title.ilike.%${keyword}%`,
        `tags.cs.{"${keyword}"}`,
        // 일원화 이전에 별도 컬럼에 남은 회고도 계속 검색되도록
        `retrospective_memo.ilike.%${keyword}%`,
        ...(memoIds.length ? [`id.in.(${memoIds.join(",")})`] : []),
      ].join(","),
    );
  }
  if (onlyIncomplete) q = q.eq("repeat", "none");

  // 미완료 여부(date = any(completed_dates))는 PostgREST로 표현하기 어려워 넉넉히 받아 거름
  const { data, error } = await q
    .order("date", { ascending: false })
    .order("start_time", { ascending: true, nullsFirst: true })
    .limit(onlyIncomplete ? limit * 4 : limit);
  if (error) return { error: error.message };

  let rows = (data ?? []) as TodoRow[];
  if (onlyIncomplete) rows = rows.filter((t) => !isDone(t)).slice(0, limit);
  const memos = await loadMemos(
    ctx,
    rows.map((t) => t.id),
  );
  return { count: rows.length, todos: rows.map((t) => view(t, memos.get(t.id) ?? "")) };
}

async function createTodos(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const input = Array.isArray(args.todos) ? args.todos.slice(0, CREATE_LIMIT) : [];
  if (!input.length) return { error: "등록할 일정이 없습니다." };

  const categories = await loadCategories(ctx);
  const skipped: { index: number; reason: string }[] = [];
  const rows: Record<string, unknown>[] = [];
  const tagSources: string[] = [];
  const memos: string[] = [];

  // 1차·2차 태그: 사용자가 명시한 값은 유지, 아니면 과거 이력(전체 기간)에서 추론 → 없으면 기본값 (일반 추가 폼과 같은 규칙)
  const resolved = await Promise.all(
    input.map(async (raw) => {
      const t = (raw ?? {}) as Record<string, unknown>;
      const title = str(t.title).slice(0, TITLE_MAX);
      if (!title) return null;
      const manualCategory = categories.includes(str(t.category)) ? str(t.category) : null;
      return resolveTodoTags(ctx.supabase, ctx.userId, title, { category: manualCategory, tags: tagList(t.tags) }, { categories });
    }),
  );

  input.forEach((raw, index) => {
    const t = (raw ?? {}) as Record<string, unknown>;
    const title = str(t.title).slice(0, TITLE_MAX);
    const date = isoDate(t.date);
    const tagInfo = resolved[index];
    if (!title || !date || !tagInfo) {
      skipped.push({ index, reason: "title 또는 date(YYYY-MM-DD)가 없습니다." });
      return;
    }
    const start_time = hhmm(t.start_time);
    let end_time = start_time ? hhmm(t.end_time) : null;
    if (start_time && end_time && end_time <= start_time) end_time = null;
    const repeat = REPEATS.includes(t.repeat as Repeat) ? (t.repeat as Repeat) : "none";

    // due_date·is_completed는 todos_sync_legacy 트리거(015)가 채움
    rows.push({
      user_id: ctx.userId,
      title,
      date,
      start_time,
      end_time,
      category: tagInfo.category || DEFAULT_CATEGORY,
      tags: tagInfo.tags.length ? tagInfo.tags : [DEFAULT_TAG],
      repeat,
    });
    tagSources.push(tagInfo.source);
    memos.push(typeof t.memo === "string" ? t.memo.trim().slice(0, MEMO_MAX) : "");
  });

  if (!rows.length) return { error: "등록 가능한 일정이 없습니다.", skipped };
  const { data, error } = await ctx.supabase.from("todos").insert(rows).select(TODO_COLUMNS);
  if (error) return { error: error.message, skipped };
  const created = (data ?? []) as TodoRow[];

  // 세부 메모를 함께 받은 일정은 todo_details에 저장 (insert 결과는 요청 순서와 같음)
  const detailRows = created
    .map((row, i) => ({ todo_id: row.id, user_id: ctx.userId, memo: memos[i] ?? "" }))
    .filter((r) => r.memo);
  let memoError: string | undefined;
  if (detailRows.length) {
    const { error: dErr } = await ctx.supabase.from("todo_details").insert(detailRows);
    if (dErr) memoError = `일정은 등록됐지만 세부 메모 저장 실패: ${dErr.message}`;
  }

  return {
    created: created.length,
    // tagSource: manual(사용자 지정) · exact(같은 제목 이력) · keyword(유사 업무 이력) · default(이력 없음 → 기본값)
    todos: created.map((row, i) => ({ ...view(row, memos[i] || undefined), tagSource: tagSources[i] })),
    skipped,
    ...(memoError ? { memoError } : {}),
  };
}

async function updateTodos(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const input = Array.isArray(args.updates) ? args.updates.slice(0, UPDATE_LIMIT) : [];
  if (!input.length) return { error: "수정할 일정이 없습니다." };

  let categories: string[] | null = null;
  const results: ToolResult[] = [];

  for (const raw of input) {
    const u = (raw ?? {}) as Record<string, unknown>;
    const found = await findTodo(u, ctx);
    if ("result" in found) {
      results.push({ target: u.todoId ?? u.titleQuery ?? u.date, ...found.result });
      continue;
    }
    const todo = found.todo;
    const patch: Record<string, unknown> = {};
    const fail = (error: string) => results.push({ id: todo.id, title: todo.title, error });

    // 제목
    if (u.title !== undefined) {
      const title = str(u.title).slice(0, TITLE_MAX);
      if (!title) {
        fail("제목은 비울 수 없습니다.");
        continue;
      }
      if (title !== todo.title) patch.title = title;
    }

    // 1차 태그
    if (u.category !== undefined) {
      categories ??= await loadCategories(ctx);
      const c = str(u.category);
      if (!categories.includes(c)) {
        fail(`사용할 수 없는 1차 태그입니다. 가능한 값: ${categories.join(", ")}`);
        continue;
      }
      patch.category = c;
    }

    // 2차 태그: 전체 교체 → 추가 → 제거. 비면 기본 태그
    if (Array.isArray(u.tags) || Array.isArray(u.addTags) || Array.isArray(u.removeTags)) {
      let tags = Array.isArray(u.tags) ? tagList(u.tags) : [...(todo.tags ?? [])];
      for (const t of tagList(u.addTags)) if (!tags.includes(t)) tags.push(t);
      const remove = tagList(u.removeTags);
      tags = tags.filter((t) => !remove.includes(t));
      patch.tags = tags.length ? tags : [DEFAULT_TAG];
    }

    // 반복
    if (u.repeat !== undefined) {
      if (!REPEATS.includes(u.repeat as Repeat)) {
        fail(`반복 값이 올바르지 않습니다. 가능한 값: ${REPEATS.join(", ")}`);
        continue;
      }
      patch.repeat = u.repeat;
    }
    const repeat = (patch.repeat as string | undefined) ?? todo.repeat;

    // 날짜 이동: 반복 없는 일정은 앱(moveTodoToDate)과 같이 완료 상태를 새 날짜로 옮김
    let completed = [...(todo.completed_dates ?? [])];
    let date = todo.date;
    if (u.newDate !== undefined) {
      const d = isoDate(u.newDate);
      if (!d) {
        fail("newDate는 YYYY-MM-DD 형식이어야 합니다.");
        continue;
      }
      if (d !== todo.date) {
        patch.date = d;
        if (repeat === "none") {
          completed = isDone(todo) ? [d] : [];
          patch.completed_dates = completed;
        }
        date = d;
      }
    }

    // 시간: 해제 → 지정·변경 순. 종료만 있는 상태·역전은 막음
    let start = todo.start_time?.slice(0, 5) ?? null;
    let end = todo.end_time?.slice(0, 5) ?? null;
    if (u.clearTime === true) start = end = null;
    if (u.clearEndTime === true) end = null;
    if (u.start_time !== undefined && u.start_time !== null && u.start_time !== "") {
      const s = hhmm(u.start_time);
      if (!s) {
        fail("start_time은 HH:MM 형식이어야 합니다.");
        continue;
      }
      start = s;
    }
    if (u.end_time !== undefined && u.end_time !== null && u.end_time !== "") {
      const e = hhmm(u.end_time);
      if (!e) {
        fail("end_time은 HH:MM 형식이어야 합니다.");
        continue;
      }
      end = e;
    }
    if (end && !start) {
      fail("시작 시간 없이 종료 시간만 지정할 수 없습니다.");
      continue;
    }
    if (start && end && end <= start) {
      fail("종료 시간은 시작 시간보다 늦어야 합니다.");
      continue;
    }
    if (start !== (todo.start_time?.slice(0, 5) ?? null)) patch.start_time = start;
    if (end !== (todo.end_time?.slice(0, 5) ?? null)) patch.end_time = end;

    // 완료 체크·해제: 반복 없는 일정 = 그 일정 날짜, 반복 일정 = occurrenceDate(기본 오늘)
    if (typeof u.done === "boolean") {
      const on = repeat === "none" ? date : (isoDate(u.occurrenceDate) ?? ctx.today);
      const has = completed.includes(on);
      if (u.done && !has) completed = [...completed, on];
      if (!u.done && has) completed = completed.filter((x) => x !== on);
      if (u.done !== has) patch.completed_dates = completed;
    }

    if (!Object.keys(patch).length) {
      results.push({ id: todo.id, title: todo.title, unchanged: true, message: "바뀐 내용이 없습니다." });
      continue;
    }

    // due_date·is_completed는 트리거가 date·completed_dates로 맞춤
    const { data, error } = await ctx.supabase
      .from("todos")
      .update(patch)
      .eq("user_id", ctx.userId)
      .eq("id", todo.id)
      .select(TODO_COLUMNS)
      .single();
    if (error) {
      fail(error.message);
      continue;
    }
    results.push({ ok: true, changed: Object.keys(patch), todo: view(data as TodoRow) });
  }

  const okCount = results.filter((r) => r.ok).length;
  return {
    updated: okCount,
    failed: results.filter((r) => r.error || r.needsChoice).length,
    results,
    ...(okCount === 0 && results.every((r) => r.error) ? { error: "수정된 일정이 없습니다." } : {}),
  };
}

async function carryOverTodos(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const target = isoDate(args.targetDate);
  if (!target) return { error: "targetDate(YYYY-MM-DD)가 필요합니다." };

  const from = isoDate(args.sourceDate);
  const to = isoDate(args.sourceEndDate) ?? from;
  const ids = Array.isArray(args.todoIds) ? args.todoIds.filter((v): v is string => typeof v === "string") : [];
  const allOverdue = args.allOverdue === true;
  if (!from && !allOverdue && !ids.length) return { error: "sourceDate, allOverdue, todoIds 중 하나가 필요합니다." };

  let q = ctx.supabase
    .from("todos")
    .select(TODO_COLUMNS)
    .eq("user_id", ctx.userId)
    .eq("repeat", "none")
    .neq("date", target);
  if (from && to) q = q.gte("date", from).lte("date", to);
  else if (allOverdue) q = q.lt("date", ctx.today);
  if (ids.length) q = q.in("id", ids);

  const { data, error } = await q.order("date", { ascending: true }).limit(CARRY_LIMIT * 3);
  if (error) return { error: error.message };

  const targets = ((data ?? []) as TodoRow[]).filter((t) => !isDone(t)).slice(0, CARRY_LIMIT);
  if (!targets.length) return { moved: 0, message: "옮길 미완료 일정이 없습니다." };

  // 앱의 moveTodoToDate와 같은 규칙: 미완료 일정을 옮길 때 completed_dates는 비움
  const { error: upErr } = await ctx.supabase
    .from("todos")
    .update({ date: target, completed_dates: [] })
    .eq("user_id", ctx.userId)
    .in(
      "id",
      targets.map((t) => t.id),
    );
  if (upErr) return { error: upErr.message };

  return {
    moved: targets.length,
    targetDate: target,
    todos: targets.map((t) => ({ id: t.id, title: t.title, fromDate: t.date })),
  };
}

async function updateTodoMemo(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const mode = args.mode === "replace" || args.mode === "clear" ? args.mode : "append";
  const text = typeof args.memo === "string" ? args.memo.trim() : "";
  if (mode !== "clear" && !text) return { error: "memo(작성할 내용)가 필요합니다. 메모를 비우려면 mode=clear." };

  const found = await findTodo(args, ctx);
  if ("result" in found) return found.result;
  const { todo } = found;

  const res = await writeMemo(ctx, todo.id, mode, text);
  if ("error" in res) return res;
  return {
    updated: true,
    target: "세부 메모",
    mode,
    todo: { id: todo.id, title: todo.title, date: todo.date },
    memo: res.memo,
  };
}

async function deleteTodos(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const ids = [
    ...new Set((Array.isArray(args.todoIds) ? args.todoIds : []).filter((v): v is string => typeof v === "string" && !!v.trim())),
  ].slice(0, DELETE_LIMIT);
  if (!ids.length) return { error: "삭제할 일정 id(todoIds)가 필요합니다. 모르면 먼저 search_todos로 찾으세요." };

  const { data, error } = await ctx.supabase
    .from("todos")
    .select("id, title, date, start_time")
    .eq("user_id", ctx.userId)
    .in("id", ids);
  if (error) return { error: error.message };
  const targets = (data ?? []) as { id: string; title: string; date: string; start_time: string | null }[];
  const notFound = ids.filter((id) => !targets.some((t) => t.id === id));
  if (!targets.length) return { error: "삭제할 일정을 찾지 못했습니다.", notFound };

  const list = targets.map((t) => ({ id: t.id, title: t.title, date: t.date, start_time: t.start_time?.slice(0, 5) ?? null }));

  // 안전장치: 다량 삭제는 사용자 확인을 받은 뒤에만
  if (targets.length >= DELETE_CONFIRM_AT && args.confirmed !== true) {
    return {
      needsConfirmation: true,
      count: targets.length,
      todos: list,
      message: `${targets.length}건 삭제는 사용자 확인이 필요합니다. 아래 목록을 보여주고 동의를 받으면 confirmed=true로 다시 호출하세요. 아직 아무것도 삭제하지 않았습니다.`,
    };
  }

  const targetIds = targets.map((t) => t.id);
  const removeDetails = () => ctx.supabase.from("todo_details").delete().in("todo_id", targetIds);
  const removeTodos = () => ctx.supabase.from("todos").delete().eq("user_id", ctx.userId).in("id", targetIds).select("id");

  let del = await removeTodos();
  // todo_details가 ON DELETE CASCADE 없이 todos를 참조하면 먼저 상세를 지우고 다시 시도
  if (del.error?.code === "23503") {
    const d = await removeDetails();
    if (d.error) return { error: `세부 메모 삭제 실패: ${d.error.message}` };
    del = await removeTodos();
  }
  if (del.error) return { error: del.error.message };
  const deletedIds = ((del.data ?? []) as { id: string }[]).map((r) => r.id);
  if (!deletedIds.length) return { error: "일정을 삭제하지 못했습니다(권한 또는 이미 삭제됨)." };

  // 참조 제약이 없는 경우 남는 상세(세부 메모·하위 작업)도 정리
  const leftover = await removeDetails();
  if (leftover.error) console.error("[assistant] todo_details cleanup failed", leftover.error.message);

  return {
    deleted: deletedIds.length,
    deletedIds,
    todos: list.filter((t) => deletedIds.includes(t.id)),
    ...(notFound.length ? { notFound } : {}),
  };
}

const EXECUTORS: Record<string, (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>> = {
  search_todos: searchTodos,
  create_todos: createTodos,
  update_todos: updateTodos,
  carry_over_todos: carryOverTodos,
  update_todo_memo: updateTodoMemo,
  // 이전 이름 (호환)
  update_todo_detail_memo: updateTodoMemo,
  delete_todos: deleteTodos,
};

/** 데이터를 바꾸는 도구 — 클라이언트가 목록을 다시 불러올지 판단하는 데 사용 */
export const MUTATING_TOOLS = new Set([
  "create_todos",
  "update_todos",
  "carry_over_todos",
  "update_todo_memo",
  "update_todo_detail_memo",
  "delete_todos",
]);

export async function runTool(name: string, args: Record<string, unknown> | undefined, ctx: ToolContext): Promise<ToolResult> {
  const exec = EXECUTORS[name];
  if (!exec) return { error: `알 수 없는 도구: ${name}` };
  try {
    const result = await exec(args ?? {}, ctx);
    // DB 오류 등은 모델에게 결과로 넘기되 서버 로그에도 남김
    if (result.error) console.error(`[assistant] tool ${name} returned error:`, result.error, { args });
    return result;
  } catch (e) {
    console.error(`[assistant] tool ${name} threw`, e instanceof Error ? e.stack : e, { args });
    return { error: `도구 실행 중 오류: ${e instanceof Error ? e.message : String(e)}` };
  }
}
