// 타임테이블 백그라운드 알림 발송 (Supabase Edge Function · Deno)
//
// 매분 Supabase Cron(pg_cron → pg_net)이 호출 → 각 기기의 시간대 기준으로
//   - 시작 5분 전: "N분 후 업무 시작: [업무명]"
//   - 시작 시각  : "업무 시작 시간입니다: [업무명]"
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

type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";
type Todo = {
  id: string;
  user_id: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  repeat: Repeat;
  completed_dates: string[];
};
type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string; tz: string };
type Alarm = { userId: string; tz: string; key: string; title: string; body: string; tag: string; phase: "pre" | "start" };

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
    date: String(row.date ?? row.due_date ?? row.created_at ?? "").slice(0, 10),
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    repeat: REPEATS.includes(row.repeat as Repeat) ? (row.repeat as Repeat) : "none",
    completed_dates: Array.isArray(row.completed_dates) ? row.completed_dates : [],
  };
}

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
  const { data: todoRows, error: todoErr } = await db
    .from("todos")
    .select("*")
    .in("user_id", userIds)
    .not("start_time", "is", null)
    .lte("date", todays[todays.length - 1])
    .or(`repeat.neq.none,date.gte.${todays[0]}`);
  if (todoErr) return Response.json({ error: todoErr.message }, { status: 500 });
  const todos = (todoRows ?? []).map(normalize);

  // 지금 울려야 할 알림
  const due: Alarm[] = [];
  for (const g of groups.values()) {
    const { date, min } = localNow(g.tz, now);
    for (const t of todos) {
      if (t.user_id !== g.userId || !occursOn(t, date) || t.completed_dates.includes(date)) continue;
      const start = toMin(t.start_time);
      if (start === null) continue;
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
        title: phase === "start" ? `업무 시작 시간입니다: ${t.title}` : `${start - min}분 후 업무 시작: ${t.title}`,
        body: `${hhmm(t.start_time)}${t.end_time ? ` – ${endLabel(t.end_time)}` : ""}`,
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
    const payload = JSON.stringify({ title: a.title, body: a.body, tag: a.tag, url: "/", phase: a.phase });
    for (const s of groups.get(`${a.userId}|${a.tz}`)!.subs) {
      jobs.push(
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: a.phase === "start" ? 600 : 300,
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
