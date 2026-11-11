-- 종일 일정(연차·휴가·여행·출장 등). 날짜 표시 영역 아래 배너에 색상 칩으로 표시됩니다.
--   date ~ end_date(포함) 기간의 매일에 노출. end_date가 비어 있으면 하루 일정.
--   RLS로 본인 행만 읽고 쓰며, Realtime(supabase_realtime)에 등록해 PC ↔ 모바일 실시간 반영.
-- Supabase SQL Editor에서 통째로 실행하세요. 여러 번 실행해도 안전합니다.

begin;

create table if not exists public.all_day_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  end_date   date,
  title      text not null check (char_length(title) between 1 and 60),
  emoji      text not null default '📌' check (char_length(emoji) <= 16),
  color      text not null default '#007aff' check (color ~* '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint all_day_events_range check (end_date is null or end_date >= date)
);

create index if not exists all_day_events_user_date_idx on public.all_day_events (user_id, date);

drop trigger if exists all_day_events_touch on public.all_day_events;
create trigger all_day_events_touch before update on public.all_day_events
  for each row execute function public.touch_updated_at();

alter table public.all_day_events enable row level security;
revoke all on public.all_day_events from anon;
grant select, insert, update, delete on public.all_day_events to authenticated;

drop policy if exists "all_day_events: owner only" on public.all_day_events;
create policy "all_day_events: owner only" on public.all_day_events
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Realtime 등록 (이미 등록돼 있으면 건너뜀)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'all_day_events'
  ) then
    alter publication supabase_realtime add table public.all_day_events;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
