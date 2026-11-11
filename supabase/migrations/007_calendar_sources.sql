-- 외부 캘린더(iCal/ICS) 구독 목록.
--   sync_start: 이 날짜 이후의 일정만 스케줄러에 불러옴 (과거 데이터 연동 방지)
-- Supabase SQL Editor에서 통째로 실행하세요. 여러 번 실행해도 안전합니다.

begin;

create table if not exists public.calendar_sources (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null default '외부 캘린더' check (char_length(name) between 1 and 60),
  url        text not null check (url ~* '^https?://' and char_length(url) <= 2048),
  sync_start date not null default date_trunc('month', current_date)::date,
  color      text not null default '#8e44ad' check (color ~* '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists calendar_sources_user_id_idx on public.calendar_sources (user_id);

alter table public.calendar_sources enable row level security;
revoke all on public.calendar_sources from anon;
grant select, insert, update, delete on public.calendar_sources to authenticated;

drop policy if exists "calendar_sources: owner only" on public.calendar_sources;
create policy "calendar_sources: owner only" on public.calendar_sources
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;

notify pgrst, 'reload schema';
