import { createClient } from "@/lib/supabase/client";

/**
 * 백그라운드 알림(Web Push) 구독 관리.
 * 이 기기를 Supabase push_subscriptions에 등록하면, 매분 Cron + Edge Function(send-alarms)이
 * 업무 시작 알림을 보내고 서비스 워커가 OS 알림으로 표시 → 탭을 닫아도 도착.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type PushState = "subscribed" | "unconfigured" | "unsupported" | "no-permission" | "error";

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** 서비스 워커 준비 대기 (등록 실패 시 무한 대기하지 않도록 제한) */
async function readyRegistration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ]);
}

/** 이 기기를 푸시 구독하고 서버에 등록 (이미 구독돼 있으면 정보만 갱신: 시간대·키 교체 대응) */
export async function syncPushSubscription(): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) return "unconfigured";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission !== "granted") return "no-permission";
  try {
    const reg = await readyRegistration();
    if (!reg) return "error";
    const key = b64urlToBytes(VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();
    // 서버 키가 바뀌었으면 다시 구독
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const json = sub.toJSON();
    const { error } = await createClient().rpc("register_push_subscription", {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys?.p256dh ?? "",
      p_auth: json.keys?.auth ?? "",
      p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
      p_user_agent: navigator.userAgent.slice(0, 200),
    });
    if (error) {
      console.warn("[push] 구독 등록 실패", error.message);
      return "error";
    }
    return "subscribed";
  } catch (e) {
    console.warn("[push] 구독 실패", e);
    return "error";
  }
}

/** 이 기기의 푸시 구독 해제 (알림 끄기 · 로그아웃) */
export async function removePushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await createClient().rpc("unregister_push_subscription", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch (e) {
    console.warn("[push] 구독 해제 실패", e);
  }
}
