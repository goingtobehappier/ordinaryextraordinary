-- 다중 사용자 데이터 격리 (todos · todo_details · daily_notes)
--   1) user_id 기본값 = auth.uid(), 비어 있으면 트리거가 현재 사용자로 채움
--   2) RLS: 로그인 사용자 본인 행만 조회/생성/수정/삭제
--   3) 다른 사람의 todo에 상세(todo_details)를 붙일 수 없음
-- 앱이 user_id를 명시적으로 보내더라도 DB가 최종 방어선입니다. 여러 번 실행해도 안전합니다.

begin;

-- ── user_id 기본값 + 삽입 시 자동 채움 ──
alter table public.todos        alter column user_id set default auth.uid();
alter table public.todo_details alter column user_id set default auth.uid();
alter table public.daily_notes  alter column user_id set default auth.uid();

create or replace function public.fill_user_id()
returns trigger language plpgsql security invoker as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists todos_fill_user_id on public.todos;
create trigger todos_fill_user_id before insert on public.todos
  for each row execute function public.fill_user_id();

drop trigger if exists todo_details_fill_user_id on public.todo_details;
create trigger todo_details_fill_user_id before insert on public.todo_details
  for each row execute function public.fill_user_id();

drop trigger if exists daily_notes_fill_user_id on public.daily_notes;
create trigger daily_notes_fill_user_id before insert on public.daily_notes
  for each row execute function public.fill_user_id();

-- ── RLS ──
alter table public.todos        enable row level security;
alter table public.todo_details enable row level security;
alter table public.daily_notes  enable row level security;

-- 비로그인(anon) 접근 차단
revoke all on public.todos, public.todo_details, public.daily_notes from anon;
grant select, insert, update, delete on public.todos, public.todo_details, public.daily_notes to authenticated;

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

-- user_id 기준 조회 성능
create index if not exists todos_user_id_idx        on public.todos (user_id);
create index if not exists todo_details_user_id_idx on public.todo_details (user_id);
create index if not exists daily_notes_user_id_idx  on public.daily_notes (user_id);

commit;

-- ── 확인용: 아래 결과에서 세 테이블 모두 rls_enabled = true 이어야 합니다 ──
select relname as table_name, relrowsecurity as rls_enabled
  from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('todos', 'todo_details', 'daily_notes');

-- 주의: 아래 쿼리 결과가 0보다 크면 user_id가 비어 있는 기존 행이 있어 아무에게도 보이지 않습니다.
--   select count(*) from public.todos where user_id is null;
-- 본인 계정으로 귀속하려면 (auth.users에서 본인 id 확인 후):
--   update public.todos set user_id = '<내 user id>' where user_id is null;
