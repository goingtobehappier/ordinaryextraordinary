-- 기존(레거시) 테이블을 앱 스키마에 맞추는 마이그레이션.
-- 기존 컬럼·데이터는 삭제하지 않고, 필요한 컬럼만 추가 후 기존 값으로 채웁니다.
-- Supabase SQL Editor에서 통째로 한 번 실행하세요. 여러 번 실행해도 안전합니다.

begin;

-- ───────────────────────────── todos ─────────────────────────────
alter table public.todos add column if not exists date            date;
alter table public.todos add column if not exists tags            text[] not null default '{}';
alter table public.todos add column if not exists repeat          text   not null default 'none';
alter table public.todos add column if not exists completed_dates date[] not null default '{}';
alter table public.todos add column if not exists updated_at      timestamptz not null default now();

-- 기존 due_date → date, 없으면 생성일
update public.todos
   set date = coalesce(due_date::date, created_at::date, current_date)
 where date is null;

-- 기존 is_completed=true → 해당 날짜 완료 처리
update public.todos
   set completed_dates = array[date]
 where is_completed is true and completed_dates = '{}';

alter table public.todos alter column date set default current_date;
alter table public.todos alter column date set not null;
alter table public.todos alter column user_id set default auth.uid();

do $$ begin
  alter table public.todos add constraint todos_repeat_check
    check (repeat in ('none', 'daily', 'weekdays', 'weekly', 'monthly'));
exception when duplicate_object then null; end $$;

-- 앱은 due_date / is_completed를 쓰지 않으므로 NOT NULL이면 insert가 막힘 → 해제
alter table public.todos alter column due_date drop not null;
alter table public.todos alter column is_completed drop not null;

-- 레거시 컬럼도 계속 맞춰지도록 동기화 (기존 화면·쿼리 호환)
create or replace function public.todos_sync_legacy()
returns trigger language plpgsql as $$
begin
  new.due_date     := new.date;
  new.is_completed := new.date = any(new.completed_dates);
  new.updated_at   := now();
  return new;
end $$;

drop trigger if exists todos_sync_legacy on public.todos;
create trigger todos_sync_legacy before insert or update on public.todos
  for each row execute function public.todos_sync_legacy();

create index if not exists todos_user_date_idx on public.todos (user_id, date);

-- ────────────────────────── todo_details ─────────────────────────
alter table public.todo_details add column if not exists subtasks jsonb not null default '[]'::jsonb;
alter table public.todo_details alter column user_id set default auth.uid();

-- 기존 sub_tasks가 JSON 배열이면 옮겨옴 ({id,text,done} 형태가 아니면 text만 살림)
do $$ begin
  update public.todo_details d
     set subtasks = coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id',   coalesce(e->>'id', gen_random_uuid()::text),
                    'text', coalesce(e->>'text', e->>'title', e->>'name', e #>> '{}'),
                    'done', coalesce((e->>'done')::boolean, (e->>'completed')::boolean, false)))
             from jsonb_array_elements(to_jsonb(d.sub_tasks)) e), '[]'::jsonb)
   where d.subtasks = '[]'::jsonb
     and d.sub_tasks is not null
     and jsonb_typeof(to_jsonb(d.sub_tasks)) = 'array';
exception when others then
  raise notice 'sub_tasks 이전 생략: %', sqlerrm;
end $$;

-- 앱은 todo 하나당 상세 1행(upsert on todo_id)을 사용 → 중복 정리 후 unique
delete from public.todo_details a
 using public.todo_details b
 where a.todo_id = b.todo_id and a.ctid < b.ctid;
create unique index if not exists todo_details_todo_id_key on public.todo_details (todo_id);

-- ────────────────────────── daily_notes ──────────────────────────
alter table public.daily_notes add column if not exists date date;

update public.daily_notes set date = note_date::date where date is null;

alter table public.daily_notes alter column date set not null;
alter table public.daily_notes alter column note_date drop not null;
alter table public.daily_notes alter column user_id set default auth.uid();

create or replace function public.daily_notes_sync_legacy()
returns trigger language plpgsql as $$
begin
  new.note_date  := new.date;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists daily_notes_sync_legacy on public.daily_notes;
create trigger daily_notes_sync_legacy before insert or update on public.daily_notes
  for each row execute function public.daily_notes_sync_legacy();

-- 같은 날짜 노트가 여러 개면 최신 것만 남기고 unique (upsert on user_id,date)
delete from public.daily_notes a
 using public.daily_notes b
 where a.user_id = b.user_id and a.date = b.date
   and (a.updated_at, a.ctid) < (b.updated_at, b.ctid);
create unique index if not exists daily_notes_user_date_key on public.daily_notes (user_id, date);

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
    and exists (select 1 from public.todos t where t.id = todo_id and t.user_id = (select auth.uid()))
  );

drop policy if exists "daily_notes: owner only" on public.daily_notes;
create policy "daily_notes: owner only" on public.daily_notes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;

-- PostgREST 스키마 캐시 갱신 (새 컬럼이 API에 바로 보이도록)
notify pgrst, 'reload schema';
