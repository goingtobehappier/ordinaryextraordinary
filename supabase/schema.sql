-- ordinaryextraordinary schema — Supabase SQL Editor에서 한 번 실행하세요.
-- 모든 테이블은 RLS로 보호되며, 로그인한 사용자(auth.uid())의 행만 읽고 쓸 수 있습니다.

create extension if not exists "pgcrypto";

-- ───────────────────────────── todos ─────────────────────────────
create table if not exists public.todos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 300),
  -- 1차 태그 (필수)
  category        text not null default '업무'
                  check (category in ('일정', '미팅', '보고', '마감', '회의', '업무')),
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
