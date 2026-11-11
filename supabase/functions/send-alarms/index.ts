// 타임테이블 백그라운드 알림 발송 (Supabase Edge Function · Deno)
//
// 매분 Supabase Cron(pg_cron → pg_net)이 호출 → 각 기기의 시간대 기준으로
//   - 시작 5분 전: 제목 "✨ [업무명]", 본문 "⏰ 14:00 – 15:00 · 5분 후 시작" + "🏷️ 미팅 · #태그"
//   - 시작 시각  : 제목 "⏰ [업무명]", 본문 "⏰ 14:00 – 15:00 · 지금 시작" + "🏷️ 미팅 · #태그"
//   (브랜드 문구 없이 이모지 + 일정 제목만. 앱 안 알림 lib/alarm.ts formatAlarm과 같은 형식)
//   - 매일 10:00 · 14:00: 오늘 미완료 + 시간 미지정 할 일 리마인드
//       제목 "📌 [리마인드] 오늘 챙겨야 할 일 N건", 본문 "할 일1, 할 일2 외 N건" (0건이면 발송 안 함)
// 을 Web Push로 보냄. 서비스 워커(public/sw.js)가 받아 OS 알림으로 표시 → 탭을 닫아도 도착.
//
// 필요한 시크릿 (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT(mailto:주소), ALARM_CRON_SECRET
// SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동 제공.
// 배포: supabase functions deploy send-alarms --no-verify-jwt   (x-cron-secret 헤더로 인증)

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

/** 앱(TaskReminders)과 같은 기준 */
const LEAD_MIN = 5;
const START_GRACE_MIN = 2;
const LOG_KEEP_DAYS = 3;

/** 시간 미지정 할 일 리마인드 시각 (기기 시간대 기준 = 한국 기기는 KST) */
const DIGEST_SLOTS = [10 * 60, 14 * 60];
/** Cron이 몇 분 밀려도 놓치지 않도록 허용하는 지연 (발송 기록으로 1회만) */
const DIGEST_GRACE_MIN = 10;
/** 본문에 이름을 보여 줄 최대 개수 (나머지는 "외 N건") */
const DIGEST_NAMES = 2;

/** 알림 시각 요소 (public/icons) */
const ICON = "/icons/icon-192.png"; // 브랜드 로고
const BADGE = "/icons/badge-96.png"; // 상태바 미니 아이콘 (흰색 실루엣 · 투명 배경)
const VIBRATE = [100, 50, 100, 50, 200];
/** 기본 태그는 알림에서 생략 */
const DEFAULT_TAG = "기타업무";

type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";
type Todo = {
  id: string;
  user_id: string;
  title: string;
  category: string;
  tags: string[];
  date: string;
  start_time: string | null;
  end_time: string | null;
  repeat: Repeat;
  completed_dates: string[];
};
type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string; tz: string };
type Alarm = {
  userId: string;
  tz: string;
  key: string;
  title: string;
  body: string;
  tag: string;
  phase: "pre" | "start" | "digest";
};

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

// ───────────── 날짜 (app의 lib/date.ts와 같은 규칙, 시간대 영향 없도록 UTC 연산) ─────────────
const REPEATS: Repeat[] = ["none", "daily", "weekdays", "weekly", "monthly"];
const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const weekdayIndex = (iso: string) => (utc(iso).getUTCDay() + 6) % 7;

function occursOn(t: Todo, iso: string): boolean {
  if (iso < t.date) return false;
  if (t.repeat === "none") return iso === t.date;
  if (t.repeat === "daily") return true;
  if (t.repeat === "weekdays") return weekdayIndex(iso) < 5;
  if (t.repeat === "weekly") return weekdayIndex(iso) === weekdayIndex(t.date);
  const base = utc(t.date).getUTCDate();
  const d = utc(iso);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return d.getUTCDate() === Math.min(base, lastDay);
}

const toMin = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");
/** 저장값 23:59 → 24:00 표기 */
const endLabel = (t: string | null) => ((toMin(t) ?? 0) >= 23 * 60 + 59 ? "24:00" : hhmm(t));

/** 시간대별 현재 날짜(YYYY-MM-DD)와 분 */
function localNow(tz: string, now: Date): { date: string; min: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return localNow("Asia/Seoul", now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, min: Number(get("hour")) * 60 + Number(get("minute")) };
}

function normalize(r: Record<string, unknown>): Todo {
  const row = r as Partial<Todo> & { due_date?: string | null; created_at?: string };
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: row.title ?? "",
    category: typeof row.category === "string" ? row.category : "",
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [],
    date: String(row.date ?? row.due_date ?? row.created_at ?? "").slice(0, 10),
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    repeat: REPEATS.includes(row.repeat as Repeat) ? (row.repeat as Repeat) : "none",
    completed_dates: Array.isArray(row.completed_dates) ? row.completed_dates : [],
  };
}

/** 알림 문구: 제목 = 이모지 + 일정 제목 / 본문 = ⏰ 시간 · 상태 + 🏷️ 카테고리 · #태그 */
function formatAlarm(t: Todo, phase: "pre" | "start", minutesLeft: number) {
  const time = `${hhmm(t.start_time)}${t.end_time ? ` – ${endLabel(t.end_time)}` : ""}`;
  const status = phase === "start" ? "지금 시작" : `${minutesLeft}분 후 시작`;
  const tags = t.tags.filter((tag) => tag !== DEFAULT_TAG).map((tag) => `#${tag}`);
  const meta = [t.category, ...tags].filter(Boolean).join(" · ");
  return {
    title: `${phase === "start" ? "⏰" : "✨"} ${t.title}`,
    body: `⏰ ${time} · ${status}${meta ? `\n🏷️ ${meta}` : ""}`,
  };
}

/** 시간 미지정 리마인드 문구: "📌 [리마인드] 오늘 챙겨야 할 일 N건" / "할 일1, 할 일2 외 N건" */
function formatDigest(items: Todo[]) {
  const names = items.slice(0, DIGEST_NAMES).map((t) => t.title).join(", ");
  const rest = items.length - DIGEST_NAMES;
  return {
    title: `📌 [리마인드] 오늘 챙겨야 할 일 ${items.length}건`,
    body: rest > 0 ? `${names} 외 ${rest}건` : names,
  };
}

/** 지금이 리마인드 시각(허용 지연 포함)이면 그 슬롯(분), 아니면 null */
const digestSlot = (min: number) => DIGEST_SLOTS.find((s) => min >= s && min < s + DIGEST_GRACE_MIN) ?? null;

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== env("ALARM_CRON_SECRET")) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

  const now = new Date();
  // 오래된 발송 기록 정리
  await db.from("push_alarm_log").delete().lt("sent_at", new Date(now.getTime() - LOG_KEEP_DAYS * 86_400_000).toISOString());

  const { data: subRows, error: subErr } = await db.from("push_subscriptions").select("endpoint,user_id,p256dh,auth,tz");
  if (subErr) return Response.json({ error: subErr.message }, { status: 500 });
  const subs = (subRows ?? []) as Sub[];
  if (!subs.length) return Response.json({ sent: 0 });

  // 사용자·시간대 그룹 (같은 시간대 기기 여러 대 → 알림 1건을 모두에게)
  const groups = new Map<string, { userId: string; tz: string; subs: Sub[] }>();
  for (const s of subs) {
    const g = groups.get(`${s.user_id}|${s.tz}`) ?? { userId: s.user_id, tz: s.tz, subs: [] };
    g.subs.push(s);
    groups.set(`${s.user_id}|${s.tz}`, g);
  }

  const userIds = [...new Set(subs.map((s) => s.user_id))];
  const todays = [...groups.values()].map((g) => localNow(g.tz, now).date).sort();
  // 리마인드 시각에만 시간 미지정 할 일까지 조회 (그 외에는 시간 지정 일정만 → 매분 조회량 최소화)
  const anyDigest = [...groups.values()].some((g) => digestSlot(localNow(g.tz, now).min) !== null);
  let todoQuery = db.from("todos").select("*").in("user_id", userIds);
  if (!anyDigest) todoQuery = todoQuery.not("start_time", "is", null);
  const { data: todoRows, error: todoErr } = await todoQuery
    .lte("date", todays[todays.length - 1])
    .or(`repeat.neq.none,date.gte.${todays[0]}`);
  if (todoErr) return Response.json({ error: todoErr.message }, { status: 500 });
  const todos = (todoRows ?? []).map(normalize);

  // 지금 울려야 할 알림
  const due: Alarm[] = [];
  for (const g of groups.values()) {
    const { date, min } = localNow(g.tz, now);

    // 10:00 · 14:00 리마인드: 오늘 해당 + 미완료 + 시간 미지정 (0건이면 발송 안 함)
    const slot = digestSlot(min);
    if (slot !== null) {
      const unscheduled = todos.filter(
        (t) => t.user_id === g.userId && !t.start_time && occursOn(t, date) && !t.completed_dates.includes(date),
      );
      if (unscheduled.length) {
        // 날짜·슬롯·시간대별 1회 (발송 기록으로 Cron 중복 호출·지연 허용 구간에도 한 번만)
        const key = `digest|${date}|${slot}|${g.tz}`;
        due.push({ userId: g.userId, tz: g.tz, key, tag: key, phase: "digest", ...formatDigest(unscheduled) });
      }
    }

    for (const t of todos) {
      if (t.user_id !== g.userId || !occursOn(t, date) || t.completed_dates.includes(date)) continue;
      const start = toMin(t.start_time);
      if (start === null) continue; // 시간 미지정은 위 리마인드에서 처리
      const phase = min >= start && min <= start + START_GRACE_MIN ? "start" : min >= start - LEAD_MIN && min < start ? "pre" : null;
      if (!phase) continue;
      // 앱과 같은 키·태그 → 앱이 열려 있어 먼저 띄웠어도 같은 알림이 교체될 뿐 중복 팝업 없음
      const base = `${t.id}|${date}|${hhmm(t.start_time)}`;
      due.push({
        userId: g.userId,
        tz: g.tz,
        key: `${base}|${phase}`,
        tag: `${base}|${phase}`,
        phase,
        ...formatAlarm(t, phase, start - min),
      });
      // 늦게 감지된 정각 알림이면 미리 알림은 건너뜀
      if (phase === "start") {
        await db.from("push_alarm_log").upsert({ user_id: g.userId, alarm_key: `${base}|pre` }, { onConflict: "user_id,alarm_key", ignoreDuplicates: true });
      }
    }
  }
  if (!due.length) return Response.json({ sent: 0 });

  // 발송 기록을 먼저 남겨(on conflict do nothing) 새로 들어간 것만 발송 → Cron 중복 호출에도 1회만
  const { data: claimed, error: logErr } = await db
    .from("push_alarm_log")
    .upsert(
      due.map((a) => ({ user_id: a.userId, alarm_key: a.key })),
      { onConflict: "user_id,alarm_key", ignoreDuplicates: true },
    )
    .select("user_id,alarm_key");
  if (logErr) return Response.json({ error: logErr.message }, { status: 500 });
  const fresh = new Set((claimed ?? []).map((r) => `${r.user_id}|${r.alarm_key}`));

  let sent = 0;
  const gone: string[] = [];
  const jobs: Promise<void>[] = [];
  for (const a of due) {
    if (!fresh.has(`${a.userId}|${a.key}`)) continue;
    const payload = JSON.stringify({
      title: a.title,
      body: a.body,
      tag: a.tag,
      url: "/",
      phase: a.phase,
      icon: ICON,
      badge: BADGE,
      vibrate: VIBRATE,
    });
    for (const s of groups.get(`${a.userId}|${a.tz}`)!.subs) {
      jobs.push(
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: a.phase === "digest" ? 1800 : a.phase === "start" ? 600 : 300,
            urgency: "high",
            topic: a.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(-32),
          })
          .then(() => {
            sent++;
          })
          .catch((e: { statusCode?: number; body?: string }) => {
            // 만료·해지된 구독은 정리
            if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.endpoint);
            else console.error("push failed", e.statusCode, e.body);
          }),
      );
    }
  }
  await Promise.all(jobs);
  if (gone.length) await db.from("push_subscriptions").delete().in("endpoint", gone);

  return Response.json({ sent, expired: gone.length });
});
