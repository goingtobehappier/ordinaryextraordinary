"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { useAlarm } from "@/store/alarm";
import { notifyPermission, playChime, requestNotifyPermission, showSystemNotification, type NotifyPermission } from "@/lib/alarm";
import { syncPushSubscription } from "@/lib/pushSubscription";
import { cn } from "@/lib/cn";

/**
 * 타임테이블 알람 온/오프 + 알림 권한 요청
 *  - 켜기: 알림 권한이 아직 없으면 요청 → 확인용 차임·테스트 알림
 *  - 권한이 거부돼도 알람음과 화면 알림은 동작 (시스템 알림만 빠짐)
 */
export function AlarmToggle() {
  const enabled = useAlarm((s) => s.enabled);
  const setEnabled = useAlarm((s) => s.setEnabled);
  /** 서버 렌더와 맞추기 위해 마운트 후에만 실제 상태 표시 */
  const [perm, setPerm] = useState<NotifyPermission | null>(null);

  useEffect(() => {
    const sync = () => setPerm(notifyPermission());
    sync();
    // 브라우저 설정에서 권한을 바꾸고 돌아온 경우 반영
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  async function toggle() {
    // 켜져 있지만 아직 권한을 묻지 않았다면 → 끄지 않고 권한 요청
    if (enabled && notifyPermission() !== "default") {
      setEnabled(false);
      return;
    }
    setEnabled(true);
    playChime("pre");
    const p = await requestNotifyPermission();
    setPerm(p);
    if (p === "granted") {
      void showSystemNotification("타임테이블 알림이 켜졌습니다", {
        body: "업무 시작 5분 전과 시작 시각에 알려 드립니다. 탭을 닫아도 알림이 옵니다.",
        tag: "alarm-enabled",
      });
      // 권한을 방금 받은 경우 → 백그라운드 알림(Web Push) 구독 등록
      void syncPushSubscription();
    }
  }

  const on = perm !== null && enabled;
  const needsPermission = on && perm === "default";
  const blocked = on && (perm === "denied" || perm === "unsupported");
  const Icon = !on ? BellOff : blocked || needsPermission ? Bell : BellRing;

  const title = !on
    ? "알림 꺼짐 · 클릭하면 업무 시작 알림(알람음 · 시스템 알림) 켜기"
    : needsPermission
      ? "알림 켜짐 (알람음 · 화면 알림) · 클릭하면 시스템 알림 권한 요청"
      : perm === "denied"
        ? "알림 켜짐 (알람음 · 화면 알림만) · 시스템 알림이 차단되어 있어 브라우저 사이트 설정에서 허용해 주세요. 클릭하면 끄기"
        : perm === "unsupported"
          ? "알림 켜짐 (알람음 · 화면 알림만) · 이 브라우저는 시스템 알림을 지원하지 않습니다. iPhone은 홈 화면에 추가한 앱에서 지원. 클릭하면 끄기"
          : "알림 켜짐 · 업무 시작 5분 전 · 정각에 시스템 알림(탭을 닫아도 도착)과 알람음. 클릭하면 끄기";

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={on}
      aria-label={on ? "업무 시작 알림 끄기" : "업무 시작 알림 켜기"}
      title={title}
      className={cn(
        "relative flex size-6 items-center justify-center rounded-md outline-none transition-[background-color,color,opacity] duration-150",
        "focus-visible:ring-2 focus-visible:ring-apple-blue/50 active:scale-95 motion-reduce:active:scale-100",
        !on
          ? "text-ink-2 opacity-45 hover:bg-black/5 hover:opacity-80"
          : "bg-apple-blue/10 text-apple-blue hover:bg-apple-blue/15",
      )}
    >
      <Icon className="size-3.5" />
      {/* 시스템 알림 권한 없음 표시 */}
      {(needsPermission || blocked) && (
        <span aria-hidden className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-[#ff9500] ring-1 ring-white" />
      )}
    </button>
  );
}
