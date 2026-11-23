import type { FunctionDeclaration } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeLabels } from "@/lib/categories";
import { DEFAULT_CATEGORY, DEFAULT_TAG, type Repeat } from "@/lib/types";

/** AI 매니저 도구 실행 결과 — Gemini functionResponse.response로 그대로 전달됨 */
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

/** 모델에게 돌려줄 일정 요약 (불필요한 필드 제외) */
function view(t: TodoRow) {
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
    ai_tags: t.ai_tags ?? [],
    used_tools: t.used_tools ?? [],
    retrospective_memo: t.retrospective_memo,
  };
}

async function loadCategories(ctx: ToolContext): Promise<string[]> {
  const { data } = await ctx.supabase.from("user_categories").select("labels").eq("user_id", ctx.userId).maybeSingle();
  return normalizeLabels(data?.labels);
}

// ───────────────────────────── 도구 정의 ─────────────────────────────

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "search_todos",
    description:
      "사용자의 일정(todos)을 전체 기간(과거·미래)에서 조회한다. 작년 유사 업무 레퍼런스, 퇴근 회고 메모(retrospective_memo) 확인, 특정 기간 일정 확인에 사용. 최신 날짜순 최대 30건.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "제목·2차 태그·회고 메모에서 찾을 키워드 (부분 일치)" },
        startDate: { type: "string", description: "조회 시작일 YYYY-MM-DD (포함)" },
        endDate: { type: "string", description: "조회 종료일 YYYY-MM-DD (포함)" },
        aiTags: { type: "array", items: { type: "string" }, description: "이 중 하나라도 포함된 ai_tags" },
        usedTools: { type: "array", items: { type: "string" }, description: "이 중 하나라도 포함된 used_tools" },
        onlyIncomplete: { type: "boolean", description: "true면 미완료(반복 없는) 일정만" },
        limit: { type: "integer", description: "최대 건수 (1~30, 기본 30)" },
      },
    },
  },
  {
    name: "create_todos",
    description:
      "일정을 한 건 또는 여러 건 한 번에 등록한다. 날짜가 모호하면 오늘 기준으로 계산한 YYYY-MM-DD를 넣는다. category는 사용자 1차 태그 중 하나(모르면 생략).",
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
              start_time: { type: "string", description: "HH:MM (24시간). 종일이면 생략" },
              end_time: { type: "string", description: "HH:MM (24시간)" },
              category: { type: "string", description: "1차 태그 (예: 일정, 미팅, 보고, 마감, 회의, 업무)" },
              tags: { type: "array", items: { type: "string" }, description: "2차 태그" },
              repeat: { type: "string", enum: REPEATS, description: "반복 (기본 none)" },
              ai_tags: { type: "array", items: { type: "string" }, description: "업무 성격 키워드" },
              used_tools: { type: "array", items: { type: "string" }, description: "사용할 도구·시스템" },
            },
            required: ["title", "date"],
          },
        },
      },
      required: ["todos"],
    },
  },
  {
    name: "carry_over_todos",
    description:
      "과거 날짜의 미완료 일정(반복 없는 일정만)을 목표 날짜로 옮긴다. sourceDate 하루, sourceDate~sourceEndDate 범위, 또는 allOverdue=true(오늘 이전 전체 미완료) 중 하나로 대상을 정한다.",
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
    name: "update_retrospective",
    description:
      "특정 일정의 퇴근 회고 메모(retrospective_memo), 자동 추출 태그(ai_tags), 사용 도구(used_tools)를 저장한다. todoId를 모르면 date + titleQuery로 찾는다. 후보가 여러 개면 저장하지 않고 후보를 돌려준다.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        todoId: { type: "string", description: "일정 id" },
        date: { type: "string", description: "일정 날짜 YYYY-MM-DD (todoId가 없을 때)" },
        titleQuery: { type: "string", description: "제목 일부 (todoId가 없을 때)" },
        retrospective_memo: { type: "string", description: "회고 메모 (생략 시 기존 유지, 빈 문자열이면 삭제)" },
        ai_tags: { type: "array", items: { type: "string" } },
        used_tools: { type: "array", items: { type: "string" } },
        tagMode: { type: "string", enum: ["merge", "replace"], description: "태그 저장 방식 (기본 merge: 기존 값에 추가)" },
      },
    },
  },
];

// ───────────────────────────── 도구 실행 ─────────────────────────────

async function searchTodos(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(args.limit) || SEARCH_LIMIT, 1), SEARCH_LIMIT);
  const start = isoDate(args.startDate);
  const end = isoDate(args.endDate);
  const keyword = safeTerm(args.keyword).replace(/^#/, "");
  const aiTags = tagList(args.aiTags);
  const usedTools = tagList(args.usedTools);
  const onlyIncomplete = args.onlyIncomplete === true;

  let q = ctx.supabase.from("todos").select(TODO_COLUMNS).eq("user_id", ctx.userId);
  if (start) q = q.gte("date", start);
  if (end) q = q.lte("date", end);
  if (keyword) q = q.or(`title.ilike.%${keyword}%,retrospective_memo.ilike.%${keyword}%,tags.cs.{"${keyword}"}`);
  if (aiTags.length) q = q.overlaps("ai_tags", aiTags);
  if (usedTools.length) q = q.overlaps("used_tools", usedTools);
  if (onlyIncomplete) q = q.eq("repeat", "none");

  // 미완료 여부(date = any(completed_dates))는 PostgREST로 표현하기 어려워 넉넉히 받아 거름
  const { data, error } = await q
    .order("date", { ascending: false })
    .order("start_time", { ascending: true, nullsFirst: true })
    .limit(onlyIncomplete ? limit * 4 : limit);
  if (error) return { error: error.message };

  let rows = (data ?? []) as TodoRow[];
  if (onlyIncomplete) rows = rows.filter((t) => !isDone(t)).slice(0, limit);
  return { count: rows.length, todos: rows.map(view) };
}

async function createTodos(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const input = Array.isArray(args.todos) ? args.todos.slice(0, CREATE_LIMIT) : [];
  if (!input.length) return { error: "등록할 일정이 없습니다." };

  const categories = await loadCategories(ctx);
  const skipped: { index: number; reason: string }[] = [];
  const rows: Record<string, unknown>[] = [];

  input.forEach((raw, index) => {
    const t = (raw ?? {}) as Record<string, unknown>;
    const title = str(t.title).slice(0, 200);
    const date = isoDate(t.date);
    if (!title || !date) {
      skipped.push({ index, reason: "title 또는 date(YYYY-MM-DD)가 없습니다." });
      return;
    }
    const start_time = hhmm(t.start_time);
    let end_time = start_time ? hhmm(t.end_time) : null;
    if (start_time && end_time && end_time <= start_time) end_time = null;
    const category = categories.includes(str(t.category)) ? str(t.category) : DEFAULT_CATEGORY;
    const tags = tagList(t.tags);
    const repeat = REPEATS.includes(t.repeat as Repeat) ? (t.repeat as Repeat) : "none";

    // due_date·is_completed는 todos_sync_legacy 트리거(015)가 채움
    rows.push({
      user_id: ctx.userId,
      title,
      date,
      start_time,
      end_time,
      category,
      tags: tags.length ? tags : [DEFAULT_TAG],
      repeat,
      ai_tags: tagList(t.ai_tags),
      used_tools: tagList(t.used_tools),
    });
  });

  if (!rows.length) return { error: "등록 가능한 일정이 없습니다.", skipped };
  const { data, error } = await ctx.supabase.from("todos").insert(rows).select(TODO_COLUMNS);
  if (error) return { error: error.message, skipped };
  const created = (data ?? []) as TodoRow[];
  return { created: created.length, todos: created.map(view), skipped };
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

async function updateRetrospective(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  let todo: TodoRow | null = null;
  const todoId = str(args.todoId);

  if (todoId) {
    const { data, error } = await ctx.supabase
      .from("todos")
      .select(TODO_COLUMNS)
      .eq("user_id", ctx.userId)
      .eq("id", todoId)
      .maybeSingle();
    if (error) return { error: error.message };
    todo = data as TodoRow | null;
    if (!todo) return { error: "해당 id의 일정을 찾지 못했습니다." };
  } else {
    const date = isoDate(args.date);
    const titleQuery = safeTerm(args.titleQuery);
    if (!date && !titleQuery) return { error: "todoId 또는 date/titleQuery가 필요합니다." };
    let q = ctx.supabase.from("todos").select(TODO_COLUMNS).eq("user_id", ctx.userId);
    if (date) q = q.eq("date", date);
    if (titleQuery) q = q.ilike("title", `%${titleQuery}%`);
    const { data, error } = await q.order("date", { ascending: false }).limit(10);
    if (error) return { error: error.message };
    const rows = (data ?? []) as TodoRow[];
    if (!rows.length) return { error: "조건에 맞는 일정을 찾지 못했습니다." };
    if (rows.length > 1) {
      return { needsChoice: true, message: "후보가 여러 개입니다. 사용자에게 어떤 일정인지 확인하세요.", candidates: rows.map(view) };
    }
    todo = rows[0];
  }

  const replace = args.tagMode === "replace";
  const patch: Record<string, unknown> = {};
  if (typeof args.retrospective_memo === "string") patch.retrospective_memo = args.retrospective_memo.trim().slice(0, 5000) || null;
  if (Array.isArray(args.ai_tags)) {
    const next = tagList(args.ai_tags);
    patch.ai_tags = replace ? next : tagList([...(todo.ai_tags ?? []), ...next]);
  }
  if (Array.isArray(args.used_tools)) {
    const next = tagList(args.used_tools);
    patch.used_tools = replace ? next : tagList([...(todo.used_tools ?? []), ...next]);
  }
  if (!Object.keys(patch).length) return { error: "저장할 내용(retrospective_memo, ai_tags, used_tools)이 없습니다." };

  const { data, error } = await ctx.supabase
    .from("todos")
    .update(patch)
    .eq("user_id", ctx.userId)
    .eq("id", todo.id)
    .select(TODO_COLUMNS)
    .single();
  if (error) return { error: error.message };
  return { updated: true, todo: view(data as TodoRow) };
}

const EXECUTORS: Record<string, (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>> = {
  search_todos: searchTodos,
  create_todos: createTodos,
  carry_over_todos: carryOverTodos,
  update_retrospective: updateRetrospective,
};

/** 데이터를 바꾸는 도구 — 클라이언트가 목록을 다시 불러올지 판단하는 데 사용 */
export const MUTATING_TOOLS = new Set(["create_todos", "carry_over_todos", "update_retrospective"]);

export async function runTool(name: string, args: Record<string, unknown> | undefined, ctx: ToolContext): Promise<ToolResult> {
  const exec = EXECUTORS[name];
  if (!exec) return { error: `알 수 없는 도구: ${name}` };
  try {
    return await exec(args ?? {}, ctx);
  } catch (e) {
    console.error("[assistant] tool failed", name, e);
    return { error: "도구 실행 중 오류가 발생했습니다." };
  }
}
