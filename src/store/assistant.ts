"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { normalizeTodo } from "@/lib/types";
import { useCockpit } from "@/store/cockpit";

/** O.E. Buddy 대화 상태 — PC(우측 패널 교체)와 모바일(O.E. Buddy 탭)이 같은 대화를 공유 */

export const ASSISTANT_NAME = "O.E. Buddy";

/** AI가 데이터를 바꿈 → 열려 있는 상세 화면이 세부 메모·하위 작업을 서버에서 다시 불러옴 */
export const DETAIL_RELOAD_EVENT = "cockpit:detail-reload";

export type ChatMessage = { role: "user" | "assistant"; content: string; error?: boolean };
export type MobileTab = "manager" | "timeblock";

type ActionLog = { tool?: string; result?: { deletedIds?: unknown } };

type AssistantResponse = {
  reply?: string;
  actions?: ActionLog[];
  changed?: boolean;
  error?: string;
  stage?: string;
  toolErrors?: string[];
};

/** 서버가 실행한 도구 기록에서 삭제된 일정 id 모으기 */
const deletedIdsOf = (actions: ActionLog[] | undefined) =>
  new Set(
    (actions ?? [])
      .filter((a) => a.tool === "delete_todos" && Array.isArray(a.result?.deletedIds))
      .flatMap((a) => (a.result!.deletedIds as unknown[]).filter((v): v is string => typeof v === "string")),
  );

/**
 * AI 변경 반영: 보이는 범위·미완료 목록을 다시 불러오고(rev 증가 → 검색·요약도 갱신),
 * 열려 있는 상세 화면은 삭제됐으면 닫고, 범위 밖(검색·요약에서 연) 일정이면 단건으로 다시 받아 유지한 뒤
 * 세부 메모·하위 작업도 다시 불러오게 함.
 */
async function applyAssistantChanges(deleted: Set<string>) {
  const cockpit = useCockpit.getState();
  const selected = cockpit.selectedTodoId;
  if (selected && deleted.has(selected)) cockpit.selectTodo(null);

  await cockpit.resync();

  const sel = useCockpit.getState().selectedTodoId;
  if (sel && !useCockpit.getState().todos.some((t) => t.id === sel)) {
    const { data } = await createClient().from("todos").select("*").eq("id", sel).maybeSingle();
    if (data) useCockpit.getState().ensureTodo(normalizeTodo(data));
    else useCockpit.getState().selectTodo(null);
  }
  window.dispatchEvent(new Event(DETAIL_RELOAD_EVENT));
}

export const QUICK_PROMPTS = [
  "오늘 일정 브리핑",
  "어제 미완료 일정 오늘로 이월해줘",
  "작년 이맘때 유사 업무 찾아줘",
  "오늘 완료한 업무 1분 회고 정리해줘",
];

/** 서버로 보내는 대화 길이 (API도 최근 20개만 사용) */
const HISTORY_LIMIT = 20;

/** 서버가 알려준 실패 단계 → 화면 표시용 이름 */
const STAGE_LABEL: Record<string, string> = {
  config: "서버 설정",
  auth: "인증",
  request: "요청 형식",
  gemini: "Gemini API 호출",
  server: "서버 처리",
};

class AssistantError extends Error {
  constructor(
    message: string,
    readonly changed: boolean,
    readonly actions?: ActionLog[],
  ) {
    super(message);
  }
}

async function askAssistant(messages: ChatMessage[]): Promise<AssistantResponse> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;

  let res: Response;
  try {
    res = await fetch("/api/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages: messages
          .filter((m) => !m.error)
          .slice(-HISTORY_LIMIT)
          .map(({ role, content }) => ({ role, content })),
      }),
    });
  } catch (e) {
    throw new AssistantError(`[네트워크] 서버에 연결하지 못했습니다. (${e instanceof Error ? e.message : String(e)})`, false);
  }

  // 실패 응답이 JSON이 아닐 수도 있음 (예: 호스팅 시간 초과 페이지)
  const text = await res.text();
  let body: AssistantResponse = {};
  try {
    body = text ? (JSON.parse(text) as AssistantResponse) : {};
  } catch {
    body = { error: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) };
  }

  if (!res.ok) {
    const stage = body.stage ? (STAGE_LABEL[body.stage] ?? body.stage) : res.status === 401 ? "인증" : "응답";
    const lines = [
      `[${stage} 실패 · HTTP ${res.status}]`,
      body.error || res.statusText || "응답을 받지 못했습니다.",
      ...(body.toolErrors?.length ? ["", "DB 도구 오류:", ...body.toolErrors] : []),
    ];
    throw new AssistantError(lines.join("\n"), body.changed === true, body.actions);
  }
  return body;
}

type AssistantState = {
  messages: ChatMessage[];
  input: string;
  pending: boolean;
  /** PC: 우측 메모 패널 자리를 대화창으로 교체 중 */
  open: boolean;
  /** 모바일 하단 탭 (접속 시 O.E. Buddy가 기본) */
  mobileTab: MobileTab;
  setInput: (v: string) => void;
  setOpen: (open: boolean) => void;
  setMobileTab: (tab: MobileTab) => void;
  /** 모바일 타임블록 빈 칸 탭 등: 입력창에 문구를 채워 대화 화면으로 */
  startDraft: (text: string) => void;
  send: (text: string) => Promise<void>;
  reset: () => void;
};

export const useAssistant = create<AssistantState>()((set, get) => ({
  messages: [],
  input: "",
  pending: false,
  open: false,
  mobileTab: "manager",
  setInput: (input) => set({ input }),
  setOpen: (open) => set({ open }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  startDraft: (text) => set({ input: text, open: true, mobileTab: "manager" }),
  reset: () => {
    if (get().pending) return;
    set({ messages: [], input: "" });
  },
  send: async (text) => {
    const content = text.trim();
    if (!content || get().pending) return;
    const next: ChatMessage[] = [...get().messages, { role: "user", content }];
    set({ messages: next, input: "", pending: true });

    let changed = false;
    let actions: ActionLog[] | undefined;
    try {
      const res = await askAssistant(next);
      changed = res.changed === true;
      actions = res.actions;
      set((s) => ({ messages: [...s.messages, { role: "assistant", content: res.reply?.trim() || "응답이 비어 있습니다." }] }));
    } catch (e) {
      // 오류여도 도구가 일부 실행됐을 수 있음 (서버가 changed·actions를 함께 돌려줌)
      changed = e instanceof AssistantError && e.changed;
      actions = e instanceof AssistantError ? e.actions : undefined;
      const message = e instanceof Error ? e.message : "응답을 받지 못했습니다.";
      set((s) => ({ messages: [...s.messages, { role: "assistant", content: message, error: true }] }));
    } finally {
      set({ pending: false });
    }

    // 생성·수정·이동·완료·메모·삭제 등 어떤 변경이든 → 캘린더·타임블록·미완료 목록·검색/요약·열린 상세 화면을 즉시 최신으로
    if (changed) void applyAssistantChanges(deletedIdsOf(actions));
  },
}));
