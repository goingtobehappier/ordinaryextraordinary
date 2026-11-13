-- ordinaryextraordinary schema — Supabase SQL Editor에서 한 번 실행하세요.
-- 모든 테이블은 RLS로 보호되며, 로그인한 사용자(auth.uid())의 행만 읽고 쓸 수 있습니다.

create extension if not exists "pgcrypto";

-- ───────────────────────────── todos ─────────────────────────────
create table if not exists public.todos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 300),
  -- 1차 태그 (필수)
  -- 1차 태그: 사용자별 이름(user_categories, migrations/014) — 6번 '업무'는 고정
  category        text not null default '업무'
                  constraint todos_category_len check (char_length(btrim(category)) between 1 and 10),
  date            date not null,
  start_time      time,
  end_time        time,
  tags            text[] not null default array['기타업무']
                  check (cardinality(tags) > 0 and not ('' = any(tags))),
  repeat          text not null default 'none'
                  check (repeat in ('none', 'daily', 'weekdays', 'weekly', 'monthly')),
  -- 완료된 발생일 목록 (반복 일정은 날짜별로 완료 처리)
  completed_dates date[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint todos_time_order check (start_time is null or end_time is null or start_time < end_time)
);

create index if not exists todos_user_date_idx on public.todos (user_id, date);

-- ────────────────────────── todo_details ─────────────────────────
create table if not exists public.todo_details (
  todo_id    uuid primary key references public.todos (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  memo       text not null default '',
  -- [{ "id": "...", "text": "...", "done": false }]
  subtasks   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ────────────────────────── daily_notes ──────────────────────────
create table if not exists public.daily_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  content    text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

-- ─────────────────────────── updated_at ──────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists todos_touch on public.todos;
create trigger todos_touch before update on public.todos
  for each row execute function public.touch_updated_at();

drop trigger if exists todo_details_touch on public.todo_details;
create trigger todo_details_touch before update on public.todo_details
  for each row execute function public.touch_updated_at();

drop trigger if exists daily_notes_touch on public.daily_notes;
create trigger daily_notes_touch before update on public.daily_notes
  for each row execute function public.touch_updated_at();

-- ────────────────────────────── RLS ──────────────────────────────
alter table public.todos        enable row level security;
alter table public.todo_details enable row level security;
alter table public.daily_notes  enable row level security;

drop policy if exists "todos: owner only" on public.todos;
create policy "todos: owner only" on public.todos
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "todo_details: owner only" on public.todo_details;
create policy "todo_details: owner only" on public.todo_details
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    -- 다른 사람의 todo에 상세를 붙일 수 없도록 부모 소유권도 확인
    and exists (select 1 from public.todos t where t.id = todo_id and t.user_id = (select auth.uid()))
  );

drop policy if exists "daily_notes: owner only" on public.daily_notes;
create policy "daily_notes: owner only" on public.daily_notes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─────────────────────── calendar_sources (외부 캘린더) ───────────────────────
-- 테이블·RLS 정의는 migrations/007_calendar_sources.sql과 동일합니다.
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

-- ─────────────────────── lunch_skips (당일 점심시간 삭제) ───────────────────────
-- 테이블·RLS 정의는 migrations/008_lunch_skips.sql과 동일합니다.
create table if not exists public.lunch_skips (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date       date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.lunch_skips enable row level security;
revoke all on public.lunch_skips from anon;
grant select, insert, update, delete on public.lunch_skips to authenticated;

drop policy if exists "lunch_skips: owner only" on public.lunch_skips;
create policy "lunch_skips: owner only" on public.lunch_skips
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ─────────────────────── Realtime (PC ↔ 모바일 실시간 동기화) ───────────────────────
-- migrations/012_realtime.sql을 실행하면 todos·todo_details·daily_notes·lunch_skips가 supabase_realtime에 등록됩니다.

-- ─────────────────────── user_categories (1차 태그 이름 편집) ───────────────────────
-- 테이블·RLS·rename_category()·Realtime 정의는 migrations/014_user_categories.sql과 동일합니다.

-- ─────────────────────── all_day_events (종일 일정: 연차·휴가·여행) ───────────────────────
-- 테이블·RLS·Realtime 정의는 migrations/013_all_day_events.sql과 동일합니다.
