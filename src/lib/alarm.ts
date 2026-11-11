/**
 * 타임테이블 알람: 은은한 알람음(Web Audio 합성 · 음원 파일 없음) + 시스템 알림
 *
 * - 브라우저 자동재생 정책상 사용자가 페이지와 한 번 상호작용한 뒤에야 소리가 남
 *   → installAudioUnlock()으로 첫 클릭·키 입력 때 AudioContext를 깨워 둠
 * - 시스템 알림은 서비스 워커(showNotification)로 띄움 (Android Chrome은 new Notification 불가)
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** 첫 사용자 입력 때 오디오 잠금 해제 (이후 타이머에서 소리 재생 가능) */
export function installAudioUnlock() {
  const unlock = () => {
    const c = audio();
    if (c && c.state === "suspended") void c.resume();
    if (c?.state === "running") {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

/** 부드러운 벨 한 음 (사인파 + 배음, 빠른 어택 · 긴 감쇠) */
function bell(c: AudioContext, freq: number, at: number, gain: number) {
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(gain, at + 0.02);
  out.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
  out.connect(c.destination);
  for (const [mult, level] of [
    [1, 1],
    [2, 0.18],
    [3, 0.06],
  ] as const) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    g.gain.value = level;
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + 1.7);
  }
}

/**
 * 은은한 차임
 *  pre  : 미리 알림 — 한 음
 *  start: 정각 — 올라가는 두 음 (E5 → A5), 한 번 더 반복
 */
export function playChime(kind: "pre" | "start" = "start") {
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const t = c.currentTime + 0.05;
  if (kind === "pre") {
    bell(c, 659.25, t, 0.12);
    return;
  }
  bell(c, 659.25, t, 0.14);
  bell(c, 880, t + 0.32, 0.14);
  bell(c, 659.25, t + 1.3, 0.1);
  bell(c, 880, t + 1.62, 0.1);
}

export type NotifyPermission = NotificationPermission | "unsupported";

export function notifyPermission(): NotifyPermission {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

/** 알림 권한 요청 (이미 결정된 경우 그대로 반환) */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  const p = notifyPermission();
  if (p !== "default") return p;
  try {
    return await Notification.requestPermission();
  } catch {
    return notifyPermission();
  }
}

/** 알림 시각 요소 (서버 푸시 send-alarms와 동일) */
const NOTIFY_ICON = "/icons/icon-192.png";
/** 상태바 미니 아이콘: 흰색 실루엣 · 투명 배경 (Android는 알파 마스크로만 그림) */
const NOTIFY_BADGE = "/icons/badge-96.png";
const NOTIFY_VIBRATE = [100, 50, 100, 50, 200];
const DEFAULT_TAG = "기타업무";

/**
 * 알림 문구 (서버 푸시 send-alarms의 formatAlarm과 같은 형식 — 같은 tag로 교체돼도 모양이 같음)
 *  제목: "✨ 업무명"(미리) / "⏰ 업무명"(정각) — 브랜드 문구 없이 이모지 + 일정 제목
 *  본문: "⏰ 14:00 – 15:00 · 5분 후 시작" + 줄바꿈 "🏷️ 미팅 · #태그"
 */
export function formatAlarm(
  t: { title: string; category: string; tags: string[]; start_time: string | null; end_time: string | null },
  phase: "pre" | "start",
  minutesLeft: number,
  time: string,
) {
  const status = phase === "start" ? "지금 시작" : `${minutesLeft}분 후 시작`;
  const tags = t.tags.filter((tag) => tag !== DEFAULT_TAG).map((tag) => `#${tag}`);
  const meta = [t.category, ...tags].filter(Boolean).join(" · ");
  return {
    title: `${phase === "start" ? "⏰" : "✨"} ${t.title}`,
    body: `⏰ ${time} · ${status}${meta ? `\n🏷️ ${meta}` : ""}`,
  };
}

/** 시스템 알림 표시. 같은 tag는 기존 알림을 대체 (여러 탭에서 열어도 하나만 남음) */
export async function showSystemNotification(title: string, options: { body?: string; tag: string }) {
  if (notifyPermission() !== "granted") return false;
  // vibrate는 표준 옵션이지만 TS lib.dom 타입에는 빠져 있음
  const opts: NotificationOptions & { vibrate?: number[] } = {
    body: options.body,
    tag: options.tag,
    icon: NOTIFY_ICON,
    badge: NOTIFY_BADGE,
    vibrate: NOTIFY_VIBRATE,
    data: { url: "/" },
  };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, opts);
      return true;
    }
    new Notification(title, opts);
    return true;
  } catch {
    return false;
  }
}
