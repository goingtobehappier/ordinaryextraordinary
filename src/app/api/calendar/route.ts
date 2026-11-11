import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchIcs, IcsFetchError } from "@/lib/calendar/fetchIcs";
import { expandIcs, isValidTimeZone } from "@/lib/calendar/ics";
import type { CalendarResponse, CalendarSource } from "@/lib/calendar/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 한 번에 요청할 수 있는 최대 범위 (월간 6주 그리드 + 여유) */
const MAX_RANGE_DAYS = 120;

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/**
 * GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Asia/Seoul[&source=<id>]
 * 로그인 사용자의 외부 캘린더(ICS)를 받아 범위 안의 일정만 돌려줌.
 * 각 소스의 동기화 시작 날짜(sync_start) 이전 일정은 제외.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const tz = sp.get("tz") ?? "Asia/Seoul";
  const only = sp.get("source");

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return bad("from/to 날짜 형식이 올바르지 않습니다.");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) return bad("조회 범위가 너무 깁니다.");
  if (!isValidTimeZone(tz)) return bad("시간대(tz)가 올바르지 않습니다.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return bad("로그인이 필요합니다.", 401);

  // RLS로 본인 소스만 조회됨
  let query = supabase.from("calendar_sources").select("id, name, url, sync_start, color, created_at").eq("user_id", user.id);
  if (only) query = query.eq("id", only);
  const { data: sources, error } = await query;
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205";
    return bad(missing ? "calendar_sources 테이블이 없습니다. 007 마이그레이션을 실행해 주세요." : error.message, 500);
  }

  const result: CalendarResponse = { events: [], errors: [] };
  await Promise.all(
    ((sources ?? []) as CalendarSource[])
      // 동기화 시작일이 범위 끝보다 늦으면 받아올 필요 없음
      .filter((s) => s.sync_start <= to)
      .map(async (s) => {
        try {
          const text = await fetchIcs(s.url);
          result.events.push(...expandIcs(text, { sourceId: s.id, from, to, syncStart: s.sync_start, tz }));
        } catch (e) {
          const message = e instanceof IcsFetchError ? e.message : "캘린더 형식을 해석하지 못했습니다.";
          if (!(e instanceof IcsFetchError)) console.error("[calendar] parse failed", s.id, e);
          result.errors.push({ sourceId: s.id, message });
        }
      }),
  );

  result.events.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
