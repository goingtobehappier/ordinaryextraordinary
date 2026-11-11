"use client";

import { useEffect } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { noteSchemaReady } from "@/lib/dailyNotes";
import { useCockpit } from "@/store/cockpit";
import { useLunch } from "@/store/lunch";

/** 다른 기기에서 Daily Memopad가 바뀜 → 해당 날짜 편집기가 반영 */
export const NOTE_REMOTE_EVENT = "cockpit:note-remote";
export type RemoteNote = { date: string; content: string; updated_at: string | null };

/** 다른 기기에서 과업 상세(메모·하위 작업)가 바뀜 → 열려 있는 상세 패널이 반영 */
export const DETAIL_REMOTE_EVENT = "cockpit:detail-remote";
export type RemoteDetail = { todoId: string; row: Record<string, unknown> };

/** 재연결·앱 복귀: 끊긴 동안 놓친 변경을 각 화면이 다시 불러옴 */
export const RESYNC_EVENT = "cockpit:resync";

type Row = Record<string, unknown>;

/** 앱이 백그라운드에 이 시간 이상 있다가 돌아오면 다시 불러옴 (모바일은 백그라운드에서 소켓이 끊김) */
const HIDDEN_RESYNC_MS = 15_000;
/** 재동기화 최소 간격 (채널 여러 개가 동시에 재연결돼도 한 번만) */
const RESYNC_THROTTLE_MS = 5_000;

/**
 * Supabase Realtime 구독: PC ↔ 모바일 간 할 일·타임블록·Daily Memopad·상세·점심시간 변경을 새로고침 없이 반영.
 *
 * 무료 한도 관리
 *  - 로그인 사용자당 웹소켓 1개(채널 3개)만 유지하고 user_id 필터로 내 행만 수신
 *  - userId가 바뀔 때만 다시 구독, 언마운트·로그아웃 시 removeChannel로 정리 (중복 구독 없음)
 *  - DELETE는 Realtime 특성상 필터가 안 돼 기본키만 받으며, 화면에 있는 항목만 처리
 */
export function useRealtimeSync(userId: string) {
  useEffect(() => {
    const sb = createClient();
    const filter = `user_id=eq.${userId}`;
    const channels: RealtimeChannel[] = [];
    let disposed = false;
    let lastResync = Date.now();

    const resync = () => {
      if (disposed || Date.now() - lastResync < RESYNC_THROTTLE_MS) return;
      lastResync = Date.now();
      void useCockpit.getState().resync();
      void useLunch.getState().refresh();
      window.dispatchEvent(new Event(RESYNC_EVENT));
    };

    /** 구독 시작. 첫 연결은 이미 최신 데이터를 불러온 상태이므로 재연결 때만 재동기화 */
    const start = (channel: RealtimeChannel) => {
      let joined = false;
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          if (joined) resync();
          joined = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[realtime] ${channel.topic} ${status}`, err?.message ?? "");
        }
      });
      channels.push(channel);
    };

    // ── 할 일(타임블록·투두) + 상세 ──
    const onTodo = (p: RealtimePostgresChangesPayload<Row>) => {
      const s = useCockpit.getState();
      if (p.eventType === "DELETE") {
        const id = p.old?.id;
        if (typeof id === "string") s.removeRemoteTodo(id);
      } else {
        s.applyRemoteTodo(p.new);
      }
    };
    const onDetail = (p: RealtimePostgresChangesPayload<Row>) => {
      if (p.eventType === "DELETE") return; // 과업 삭제 시 함께 지워짐 → 과업 삭제 이벤트로 처리
      const todoId = p.new.todo_id;
      if (typeof todoId !== "string") return;
      window.dispatchEvent(new CustomEvent<RemoteDetail>(DETAIL_REMOTE_EVENT, { detail: { todoId, row: p.new } }));
    };
    start(
      sb
        .channel(`rt-todos:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "todos", filter }, onTodo)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "todos", filter }, onTodo)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "todos" }, onTodo)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "todo_details", filter }, onDetail)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "todo_details", filter }, onDetail),
    );

    // ── 점심시간 삭제(타임블록) — 테이블이 없어도 다른 채널에 영향이 없도록 분리 ──
    const onLunch = (p: RealtimePostgresChangesPayload<Row>) => {
      const owner = p.eventType === "DELETE" ? p.old?.user_id : p.new.user_id;
      if (owner && owner !== userId) return;
      void useLunch.getState().refresh();
    };
    start(
      sb
        .channel(`rt-lunch:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "lunch_skips", filter }, onLunch)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "lunch_skips" }, onLunch),
    );

    // ── Daily Memopad — 실제 테이블(daily_notes / 레거시 daily_memos)이 확인된 뒤 구독 ──
    void noteSchemaReady.then(({ table, dateCol }) => {
      if (disposed) return;
      const onNote = (p: RealtimePostgresChangesPayload<Row>) => {
        if (p.eventType === "DELETE") return;
        const row = p.new;
        const date = typeof row[dateCol] === "string" ? (row[dateCol] as string).slice(0, 10) : "";
        if (!date) return;
        window.dispatchEvent(
          new CustomEvent<RemoteNote>(NOTE_REMOTE_EVENT, {
            detail: {
              date,
              content: typeof row.content === "string" ? row.content : "",
              updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
            },
          }),
        );
      };
      start(
        sb
          .channel(`rt-notes:${userId}`)
          .on("postgres_changes", { event: "INSERT", schema: "public", table, filter }, onNote)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, onNote),
      );
    });

    // ── 앱 복귀·네트워크 복구 시 놓친 변경 보정 ──
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= HIDDEN_RESYNC_MS) resync();
        hiddenAt = null;
      }
    };
    const onOnline = () => resync();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      for (const ch of channels) void sb.removeChannel(ch);
    };
  }, [userId]);
}
