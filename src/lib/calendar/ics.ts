import ICAL from "ical.js";
import type { CalendarEvent } from "./types";

type Time = InstanceType<typeof ICAL.Time>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type Component = InstanceType<typeof ICAL.Component>;

/** 반복 일정 하나당 최대 반복 계산 수 (오래된 매일 반복도 충분, 무한 규칙 방지) */
const MAX_ITERATIONS = 50_000;
/** 여러 날에 걸친 일정을 날짜별로 나눌 때 최대 일수 */
const MAX_SPAN_DAYS = 62;
/** 응답 하나당 최대 일정 수 */
const MAX_EVENTS = 5_000;

/** Outlook/Exchange가 쓰는 Windows 시간대 이름 → IANA */
const WINDOWS_TZ: Record<string, string> = {
  "Korea Standard Time": "Asia/Seoul",
  "Tokyo Standard Time": "Asia/Tokyo",
  "China Standard Time": "Asia/Shanghai",
  "Taipei Standard Time": "Asia/Taipei",
  "Singapore Standard Time": "Asia/Singapore",
  "India Standard Time": "Asia/Kolkata",
  "UTC": "UTC",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "AUS Eastern Standard Time": "Australia/Sydney",
};

// ───────────────────────────── 시간대 유틸 ─────────────────────────────

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

function resolveTz(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  const cleaned = tzid.replace(/^"|"$/g, "").trim();
  if (WINDOWS_TZ[cleaned]) return WINDOWS_TZ[cleaned];
  if (isValidTimeZone(cleaned)) return cleaned;
  // 일부 피드는 "/mozilla.org/20050126_1/Asia/Seoul" 처럼 접두어를 붙임 → 마지막 두 구간
  const tail = cleaned.split("/").filter(Boolean).slice(-2).join("/");
  return tail && isValidTimeZone(tail) ? tail : null;
}

/** 순간(ms)을 tz 기준 벽시계 값으로 */
function wallParts(ms: number, tz: string) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function tzOffsetMs(ms: number, tz: string) {
  const w = wallParts(ms, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

/** tz 기준 벽시계 시각 → 순간(ms). DST 경계는 한 번 더 보정 */
function wallToInstant(y: number, mo: number, d: number, h: number, mi: number, tz: string) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, mo: number, d: number) => `${y}-${pad(mo)}-${pad(d)}`;

function addDaysIso(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// ───────────────────────────── 파싱 ─────────────────────────────

type Window = { start: string; end: string };
export type ExpandOptions = { sourceId: string; from: string; to: string; syncStart: string; tz: string };

/**
 * ICS 텍스트를 [max(syncStart, from), to] 범위의 일정으로 펼침.
 * 동기화 시작일 이전 일정은 반복 일정이라도 결과에 포함하지 않음.
 */
export function expandIcs(text: string, opts: ExpandOptions): CalendarEvent[] {
  const win: Window = { start: opts.syncStart > opts.from ? opts.syncStart : opts.from, end: opts.to };
  if (win.start > win.end) return [];

  const root = new ICAL.Component(ICAL.parse(text));
  // 시간 값은 접근할 때 해석되므로 VTIMEZONE을 먼저 등록
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(vtz);
    } catch {
      // 잘못된 시간대 정의는 무시 (TZID 이름으로 대체 해석)
    }
  }

  const masters = new Map<string, IcalEvent>();
  const orphans: IcalEvent[] = [];
  const exceptions: IcalEvent[] = [];
  root.getAllSubcomponents("vevent").forEach((c, i) => {
    let ev: IcalEvent;
    try {
      ev = new ICAL.Event(c);
    } catch {
      return;
    }
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid ? (masters.has(ev.uid) ? `${ev.uid}#${i}` : ev.uid) : `#${i}`, ev);
  });
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else orphans.push(ex);
  }

  const out: CalendarEvent[] = [];
  const emit = (item: IcalEvent, start: Time, end: Time | null, key: string) => {
    if (out.length >= MAX_EVENTS || isCancelled(item.component)) return;
    pushOccurrence(out, item, start, end, key, win, opts);
  };

  for (const [key, ev] of masters) {
    if (out.length >= MAX_EVENTS) break;
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) {
      emit(ev, ev.startDate, ev.endDate, key);
      continue;
    }
    const it = ev.iterator();
    const tzid = tzidOf(ev.component);
    for (let n = 0; n < MAX_ITERATIONS; n++) {
      const next = it.next();
      if (!next) break;
      // 시작일이 범위 끝을 넘으면 종료 (이후 발생은 모두 더 늦음)
      if (startDateIso(next, tzid, opts.tz) > win.end) break;
      const details = ev.getOccurrenceDetails(next);
      emit(details.item, details.startDate, details.endDate, `${key}@${next.toString()}`);
    }
  }
  for (const ex of orphans) emit(ex, ex.startDate, ex.endDate, `${ex.uid}@${ex.recurrenceId?.toString()}`);

  return out;
}

function isCancelled(c: Component) {
  return String(c.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
}

function tzidOf(c: Component, prop = "dtstart"): string | null {
  const v = c.getFirstProperty(prop)?.getParameter("tzid");
  return typeof v === "string" ? v : null;
}

/** ICAL.Time → 순간(ms). 알 수 없는 TZID는 이름으로, 시간대 없는(floating) 값은 사용자 시간대로 해석 */
function instantOf(t: Time, tzid: string | null, userTz: string): number {
  const zone = t.zone?.tzid;
  if (zone && zone !== "floating") return t.toUnixTime() * 1000;
  return wallToInstant(t.year, t.month, t.day, t.hour, t.minute, resolveTz(tzid) ?? userTz);
}

function startDateIso(t: Time, tzid: string | null, userTz: string) {
  if (t.isDate) return isoOf(t.year, t.month, t.day);
  const w = wallParts(instantOf(t, tzid, userTz), userTz);
  return isoOf(w.y, w.mo, w.d);
}

function pushOccurrence(
  out: CalendarEvent[],
  item: IcalEvent,
  start: Time,
  end: Time | null,
  key: string,
  win: Window,
  opts: ExpandOptions,
) {
  const title = (item.summary || "(제목 없음)").trim();
  const location = item.location?.trim() || null;
  const base = { sourceId: opts.sourceId, title, location };
  const add = (date: string, s: string | null, e: string | null, allDay: boolean) => {
    if (date < win.start || date > win.end || out.length >= MAX_EVENTS) return;
    out.push({ ...base, id: `${opts.sourceId}:${key}:${date}`, date, start: s, end: e, allDay });
  };

  // 종일 일정: DTEND는 다음 날(배타적)
  if (start.isDate) {
    const first = isoOf(start.year, start.month, start.day);
    let last = end ? addDaysIso(isoOf(end.year, end.month, end.day), -1) : first;
    if (last < first) last = first;
    for (let i = 0, d = first; i < MAX_SPAN_DAYS && d <= last; i++, d = addDaysIso(d, 1)) add(d, null, null, true);
    return;
  }

  const sTz = tzidOf(item.component, "dtstart");
  const eTz = tzidOf(item.component, "dtend") ?? sTz;
  const sMs = instantOf(start, sTz, opts.tz);
  const eMs = end ? Math.max(instantOf(end, eTz, opts.tz), sMs) : sMs;
  const s = wallParts(sMs, opts.tz);
  // 자정에 끝나면 전날 24:00으로 취급 (다음 날에 0분짜리 일정이 생기지 않게)
  const e = wallParts(eMs > sMs ? eMs - 1 : eMs, opts.tz);
  const sIso = isoOf(s.y, s.mo, s.d);
  const eIso = isoOf(e.y, e.mo, e.d);
  const sHm = `${pad(s.h)}:${pad(s.mi)}`;
  const endWall = wallParts(eMs, opts.tz);
  const eHm = eMs > sMs && endWall.h === 0 && endWall.mi === 0 ? "24:00" : `${pad(endWall.h)}:${pad(endWall.mi)}`;

  if (sIso === eIso) {
    add(sIso, sHm, eMs > sMs ? eHm : null, false);
    return;
  }
  // 여러 날에 걸친 일정: 첫날 시작~24:00, 중간 날 종일, 마지막 날 00:00~종료
  add(sIso, sHm, "24:00", false);
  for (let i = 0, d = addDaysIso(sIso, 1); i < MAX_SPAN_DAYS && d < eIso; i++, d = addDaysIso(d, 1)) add(d, null, null, true);
  add(eIso, "00:00", eHm, false);
}
