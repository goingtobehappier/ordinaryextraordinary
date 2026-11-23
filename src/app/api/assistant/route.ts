import { ApiError, GoogleGenAI, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { MUTATING_TOOLS, TOOL_DECLARATIONS, runTool, type ToolContext } from "@/lib/assistant/tools";
import { createClient } from "@/lib/supabase/server";

/** 도구 호출 왕복이 여러 번 일어날 수 있어 기본보다 넉넉히 */
export const maxDuration = 60;

/**
 * 기본 모델. GEMINI_MODEL 환경변수로 바꿀 수 있음.
 * gemini-2.5-flash는 2026-11 지원 중단(deprecated)되어 신규 키에서는 404를 돌려주므로,
 * 404(모델 없음)면 FALLBACK_MODEL로 한 번 다시 시도함.
 */
const PRIMARY_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
const TZ = "Asia/Seoul";
/** 한 요청에서 허용하는 모델↔도구 왕복 횟수 */
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 20;
const MAX_MESSAGE_LEN = 4000;

/** 실패 단계 — 클라이언트가 어디서 실패했는지 표시하는 데 사용 */
type Stage = "config" | "auth" | "request" | "gemini" | "server";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ActionLog = { tool: string; args: Record<string, unknown>; result: Record<string, unknown> };

const fail = (stage: Stage, message: string, status: number, extra?: Record<string, unknown>) =>
  NextResponse.json({ error: message, stage, ...extra }, { status });

// ───────────────────────────── 날짜 (KST) ─────────────────────────────

function kstToday(): string {
  // en-CA 형식은 YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** YYYY-MM-DD에 n일 더하기 (시간대 영향 없도록 UTC 기준 계산) */
function shift(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

function systemPrompt(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = shift(today, dow === 0 ? -6 : 1 - dow);
  const yesterday = shift(today, -1);
  const tomorrow = shift(today, 1);
  return [
    "너는 사용자의 업무 일지·일정 관리 앱 '세컨드 브레인'의 AI 매니저다.",
    `오늘은 ${today} (${weekday(today)}요일), 시간대는 한국 표준시(KST, Asia/Seoul)다.`,
    `참고 날짜: 어제 ${yesterday}(${weekday(yesterday)}), 내일 ${tomorrow}(${weekday(tomorrow)}), 이번 주 월요일 ${monday}, 1년 전 오늘 ${shift(today, -365)}.`,
    "",
    "규칙:",
    "- 답변은 간결하고 실무적인 한국어로 한다. 불필요한 인사·장황한 설명은 생략한다.",
    "- '내일', '다음 주 화요일' 같은 상대 날짜는 위 기준으로 YYYY-MM-DD로 바꿔 도구에 넘긴다. 시간은 24시간 HH:MM.",
    "- 일정 조회·과거 레퍼런스·회고 확인은 search_todos, 등록은 create_todos, 미완료 일정 이월은 carry_over_todos를 쓴다.",
    "- 메모 저장은 두 종류를 반드시 구분한다:",
    "  · '세부 메모': 일정 상세 화면의 일반 메모 입력창. '세부 메모에 ~ 적어줘', '메모 남겨줘/추가해줘'처럼 일반 메모 요청이면 update_todo_detail_memo를 쓴다. 기본은 이어 붙이기, '덮어써줘'면 mode=replace.",
    "  · '회고 메모': 세컨드 브레인 회고 영역(retrospective_memo + 사용 도구 used_tools + AI 태그 ai_tags). '회고 정리해줘', '사용 도구 기록해줘', '태그 달아줘'처럼 회고·도구·태그 요청일 때만 update_retrospective를 쓴다.",
    "  · 어느 쪽인지 애매하면 세부 메모로 처리하고, 회고로 저장하지 않는다.",
    "- 저장 후 안내 문구에는 저장한 위치를 '세부 메모' 또는 '회고 메모'로 정확히 밝힌다. 회고를 저장했으면 함께 저장한 사용 도구·AI 태그도 짧게 알려준다.",
    "- 데이터는 추측하지 말고 도구로 확인한다. 도구 결과에 없는 일정은 만들어 말하지 않는다.",
    "- 회고를 저장할 때는 내용에서 업무 성격 키워드(ai_tags)와 사용한 도구·시스템(used_tools)을 짧은 명사로 함께 추출해 저장한다.",
    "- 여러 일정의 회고를 한 번에 요청받으면 search_todos로 대상을 확인한 뒤 일정마다 update_retrospective를 호출한다.",
    "- 도구가 후보 여러 개(needsChoice)나 오류를 돌려주면 사용자에게 짧게 확인을 요청한다.",
    "- 작업을 마치면 무엇을 했는지(건수, 날짜)를 한두 줄로 요약한다. 일정 목록은 날짜·시간·제목 위주로 짧게 나열한다.",
  ].join("\n");
}

// ───────────────────────────── 인증 ─────────────────────────────

type AuthResult = { ok: true; supabase: SupabaseClient; userId: string } | { ok: false; reason: string };

/**
 * 로그인 사용자 기준 Supabase 클라이언트.
 * Authorization: Bearer <access_token>을 먼저 쓰고, 없거나 만료됐으면 세션 쿠키로 인증 → RLS(auth.uid() = user_id) 통과.
 */
async function authenticate(request: NextRequest): Promise<AuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, reason: "Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL/ANON_KEY)가 없습니다." };

  const header = request.headers.get("authorization") ?? "";
  const token = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, "").trim() : "";
  const reasons: string[] = [];

  if (token) {
    const supabase = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (data.user) return { ok: true, supabase, userId: data.user.id };
    reasons.push(`Bearer 토큰 검증 실패: ${error?.message ?? "사용자 없음"}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (data.user) return { ok: true, supabase, userId: data.user.id };
  reasons.push(`세션 쿠키 검증 실패: ${error?.message ?? "세션 없음"}`);

  return { ok: false, reason: reasons.join(" / ") };
}

// ───────────────────────────── 요청 파싱 ─────────────────────────────

function parseMessages(body: unknown): ChatMessage[] | null {
  const b = (body ?? {}) as { messages?: unknown; message?: unknown };
  const raw: unknown[] = Array.isArray(b.messages)
    ? b.messages
    : typeof b.message === "string"
      ? [{ role: "user", content: b.message }]
      : [];

  const messages = raw
    .map((m) => (m ?? {}) as Partial<ChatMessage>)
    .filter(
      (m): m is ChatMessage =>
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && !!m.content.trim(),
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LEN) }));

  // Gemini는 대화가 user 턴으로 시작해야 함 → 앞쪽 assistant 메시지 제거
  while (messages.length && messages[0].role !== "user") messages.shift();
  return messages.length && messages[messages.length - 1].role === "user" ? messages : null;
}

const hasChanges = (actions: ActionLog[]) => actions.some((a) => MUTATING_TOOLS.has(a.tool) && !a.result.error);

// ───────────────────────────── Gemini 오류 ─────────────────────────────

/** ApiError.message는 보통 응답 JSON 문자열 → 사람이 읽을 메시지만 추출 */
function geminiErrorDetail(e: unknown): { status: number | null; message: string } {
  const status = e instanceof ApiError ? e.status : null;
  const raw = e instanceof Error ? e.message : String(e);
  let message = raw;
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"))) as { error?: { message?: string; status?: string } };
    if (parsed.error?.message) message = [parsed.error.status, parsed.error.message].filter(Boolean).join(": ");
  } catch {
    // JSON이 아니면 원문 사용
  }
  return { status, message: message.slice(0, 600) };
}

const isModelNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

// ───────────────────────────── 핸들러 ─────────────────────────────

/**
 * POST /api/assistant
 * body: { messages: [{ role: "user" | "assistant", content: string }] }  (또는 { message: string })
 * 성공: { reply: string, actions: [{ tool, args, result }], changed: boolean, model: string }
 *   changed가 true면 일정 데이터가 바뀐 것이므로 클라이언트에서 목록을 다시 불러오면 됨.
 * 실패: { error: 상세 메시지, stage: "config" | "auth" | "request" | "gemini" | "server", ... }
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return fail("config", "GEMINI_API_KEY 환경변수가 설정되지 않았습니다. 배포 환경변수를 확인해 주세요.", 500);

  let auth: AuthResult;
  try {
    auth = await authenticate(request);
  } catch (e) {
    console.error("[assistant] auth failed", e);
    return fail("auth", `인증 처리 중 오류: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
  if (!auth.ok) {
    console.warn("[assistant] unauthorized:", auth.reason);
    return fail("auth", `로그인이 필요합니다. (${auth.reason})`, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("request", "요청 본문(JSON)이 올바르지 않습니다.", 400);
  }
  const messages = parseMessages(body);
  if (!messages) return fail("request", "messages 마지막 항목은 사용자 메시지여야 합니다.", 400);

  const today = kstToday();
  const ctx: ToolContext = { supabase: auth.supabase, userId: auth.userId, today };
  const ai = new GoogleGenAI({ apiKey });
  let model = PRIMARY_MODEL;

  const contents: Content[] = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const actions: ActionLog[] = [];

  /** 모델 호출. 기본 모델이 404(지원 중단·접근 불가)면 대체 모델로 한 번 재시도 */
  const generate = async (): Promise<GenerateContentResponse> => {
    const call = (m: string) =>
      ai.models.generateContent({
        model: m,
        contents,
        // temperature 등 샘플링 파라미터는 Gemini 3 이후 무시·거부되므로 보내지 않음
        config: {
          systemInstruction: systemPrompt(today),
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      });
    try {
      return await call(model);
    } catch (e) {
      if (!isModelNotFound(e) || model === FALLBACK_MODEL) throw e;
      console.warn(`[assistant] model ${model} unavailable (404) → retry with ${FALLBACK_MODEL}`, geminiErrorDetail(e).message);
      model = FALLBACK_MODEL;
      return await call(model);
    }
  };

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await generate();

      const calls = res.functionCalls ?? [];
      if (!calls.length || round === MAX_TOOL_ROUNDS) {
        const blocked = res.promptFeedback?.blockReason;
        const finish = res.candidates?.[0]?.finishReason;
        const reply =
          res.text?.trim() ||
          (calls.length
            ? "요청이 복잡해 처리를 마치지 못했습니다. 나눠서 다시 요청해 주세요."
            : blocked
              ? `응답이 차단되었습니다. (${blocked})`
              : `응답을 생성하지 못했습니다.${finish ? ` (${finish})` : ""}`);
        return NextResponse.json({ reply, actions, changed: hasChanges(actions), model });
      }

      // 모델의 함수 호출 턴을 그대로 기록 (thought signature 보존 — Gemini 3 이후 필수)
      contents.push(res.candidates?.[0]?.content ?? { role: "model", parts: calls.map((fc) => ({ functionCall: fc })) });

      // 등록 → 회고처럼 앞 결과에 의존할 수 있어 순서대로 실행
      const responses: Part[] = [];
      for (const fc of calls) {
        const name = fc.name ?? "";
        const args = (fc.args ?? {}) as Record<string, unknown>;
        const result = await runTool(name, args, ctx);
        actions.push({ tool: name, args, result });
        responses.push({ functionResponse: { id: fc.id, name, response: result } });
      }
      contents.push({ role: "user", parts: responses });
    }
  } catch (e) {
    const { status, message } = geminiErrorDetail(e);
    console.error(`[assistant] gemini request failed (model=${model}, status=${status ?? "-"})`, e instanceof Error ? e.stack : e);
    const hint =
      status === 400 && /api key/i.test(message)
        ? " — GEMINI_API_KEY가 올바른지 확인해 주세요."
        : status === 403
          ? " — API 키 권한 또는 프로젝트 설정을 확인해 주세요."
          : status === 404
            ? " — 모델을 사용할 수 없습니다. GEMINI_MODEL 환경변수로 다른 모델을 지정해 보세요."
            : status === 429
              ? " — 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
              : "";
    // 모델 응답 실패와 DB 오류(도구 결과)를 구분해 표시
    const toolErrors = actions.filter((a) => a.result.error).map((a) => `${a.tool}: ${String(a.result.error)}`);
    const isGemini = e instanceof ApiError;
    return fail(
      isGemini ? "gemini" : "server",
      `${isGemini ? "Gemini 호출 실패" : "서버 처리 오류"}${status ? ` (${status})` : ""} [${model}]: ${message}${hint}`,
      502,
      { actions, changed: hasChanges(actions), model, toolErrors },
    );
  }

  return fail("server", "응답을 생성하지 못했습니다.", 500);
}
