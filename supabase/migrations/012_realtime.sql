-- PC ↔ 모바일 실시간 동기화: 앱이 구독하는 테이블을 Supabase Realtime(publication)에 등록합니다.
-- 대상: todos(타임블록·투두) · todo_details(상세) · daily_notes/daily_memos(Daily Memopad) · lunch_skips(점심시간)
-- RLS가 그대로 적용되어 로그인한 사용자 본인의 변경만 전달됩니다 (Free 플랜 기본 Realtime 한도 내 동작).
-- Supabase SQL Editor에서 통째로 실행하세요. 여러 번 실행해도 안전합니다 (없는 테이블·이미 등록된 테이블은 건너뜀).

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['todos', 'todo_details', 'daily_notes', 'daily_memos', 'lunch_skips'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip %: 테이블 없음', t;
    elsif exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      raise notice 'skip %: 이미 등록됨', t;
    else
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'added %', t;
    end if;
  end loop;
end $$;
