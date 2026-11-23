import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { MUTATING_TOOLS, TOOL_DECLARATIONS, runTool, type ToolContext } from "@/lib/assistant/tools";
import { createClient } from "@/lib/supabase/server";

/** 도구 호출 왕복이 여러 번 일어날 수 있어 기본보다 넉넉히 */
export const maxDuration = 60;

const MODEL = "gemini-2.5-flash";
const TZ = "Asia/Seoul";
/** 한 요청에서 허용하는 모델↔도구 왕복 횟수 */
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 20;
const MAX_MESSAGE_LEN = 4000;

type ChatMessage = { role: "user" | "assistant"; content: string };
type ActionLog = { tool: string; args: Record<string, unknown>; result: Record<string, unknown> };

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

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
    "- 일정 조회·과거 레퍼런스·회고 확인은 search_todos, 등록은 create_todos, 미완료 일정 이월은 carry_over_todos, 퇴근 회고·태그·도구 기록은 update_retrospective를 쓴다.",
    "- 데이터는 추측하지 말고 도구로 확인한다. 도구 결과에 없는 일정은 만들어 말하지 않는다.",
    "- 회고를 저장할 때는 내용에서 업무 성격 키워드(ai_tags)와 사용한 도구·시스템(used_tools)을 짧은 명사로 함께 추출해 저장한다.",
    "- 도구가 후보 여러 개(needsChoice)나 오류를 돌려주면 사용자에게 짧게 확인을 요청한다.",
    "- 작업을 마치면 무엇을 했는지(건수, 날짜)를 한두 줄로 요약한다. 일정 목록은 날짜·시간·제목 위주로 짧게 나열한다.",
  ].join("\n");
}

// ───────────────────────────── 인증 ─────────────────────────────

/**
 * 로그인 사용자 기준 Supabase 클라이언트.
 * Authorization: Bearer <access_token>이 있으면 그 토큰으로, 없으면 세션 쿠키로 인증 → RLS(auth.uid() = user_id) 통과.
 */
async function authenticate(request: NextRequest): Promise<{ supabase: SupabaseClient; userId: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (token) {
    const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    return error || !data.user ? null : { supabase, userId: data.user.id };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
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

  return messages.length && messages[messages.length - 1].role === "user" ? messages : null;
}

const hasChanges = (actions: ActionLog[]) => actions.some((a) => MUTATING_TOOLS.has(a.tool) && !a.result.error);

// ───────────────────────────── 핸들러 ─────────────────────────────

/**
 * POST /api/assistant
 * body: { messages: [{ role: "user" | "assistant", content: string }] }  (또는 { message: string })
 * 응답: { reply: string, actions: [{ tool, args, result }], changed: boolean }
 *   changed가 true면 일정 데이터가 바뀐 것이므로 클라이언트에서 목록을 다시 불러오면 됨.
 */
export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return bad("GEMINI_API_KEY 환경변수가 설정되지 않았습니다.", 500);

  const auth = await authenticate(request);
  if (!auth) return bad("로그인이 필요합니다.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("요청 본문(JSON)이 올바르지 않습니다.");
  }
  const messages = parseMessages(body);
  if (!messages) return bad("messages 마지막 항목은 사용자 메시지여야 합니다.");

  const today = kstToday();
  const ctx: ToolContext = { ...auth, today };
  const ai = new GoogleGenAI({ apiKey });

  const contents: Content[] = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const actions: ActionLog[] = [];

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          systemInstruction: systemPrompt(today),
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          temperature: 0.3,
        },
      });

      const calls = res.functionCalls ?? [];
      if (!calls.length || round === MAX_TOOL_ROUNDS) {
        const reply =
          res.text?.trim() ||
          (calls.length ? "요청이 복잡해 처리를 마치지 못했습니다. 나눠서 다시 요청해 주세요." : "응답을 생성하지 못했습니다.");
        return NextResponse.json({ reply, actions, changed: hasChanges(actions) });
      }

      // 모델의 함수 호출 턴을 그대로 기록 (thought signature 등 보존)
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
    console.error("[assistant] gemini request failed", e);
    return NextResponse.json(
      { error: "AI 응답 생성 중 오류가 발생했습니다.", actions, changed: hasChanges(actions) },
      { status: 502 },
    );
  }

  return bad("응답을 생성하지 못했습니다.", 500);
}
