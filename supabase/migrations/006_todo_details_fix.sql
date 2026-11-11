-- 하위 작업(todo_details) '저장 실패' 해결용 마이그레이션.
-- 앱은 todo 하나당 1행을 upsert(on conflict todo_id)하며 { todo_id, user_id, memo, subtasks }만 보냅니다.
-- 레거시 테이블에서 아래 조건 중 하나라도 맞으면 insert/update가 실패합니다:
--   1) subtasks / memo / updated_at 컬럼 없음                  → 42703 / PGRST204
--   2) 앱이 보내지 않는 레거시 컬럼(sub_tasks 등)이 NOT NULL + 기본값 없음 → 23502
--   3) 레거시 PK(id 등)에 기본값 없음                          → 23502
--   4) todo_id unique 제약 없음                                → 42P10 (upsert 불가)
--   5) RLS 정책/권한 누락                                      → 42501
-- Supabase SQL Editor에서 통째로 실행하세요. 여러 번 실행해도 안전합니다.

begin;

-- ── 1) 앱 컬럼 보장 ──
alter table public.todo_details add column if not exists memo       text;
alter table public.todo_details add column if not exists subtasks   jsonb not null default '[]'::jsonb;
alter table public.todo_details add column if not exists updated_at timestamptz not null default now();
update public.todo_details set memo = '' where memo is null;
alter table public.todo_details alter column memo set default '';
alter table public.todo_details alter column memo set not null;

-- ── 2·3) 앱이 보내지 않는 컬럼 때문에 insert가 막히지 않도록 ──
do $$
declare
  c record;
  pk_cols text[];
begin
  select coalesce(array_agg(a.attname::text), '{}')
    into pk_cols
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = 'public.todo_details'::regclass and i.indisprimary;

  for c in
    select column_name, data_type
      from information_schema.columns
     where table_schema = 'public' and table_name = 'todo_details'
       and is_nullable = 'NO' and column_default is null
       and is_identity = 'NO' and is_generated = 'NEVER'
       and column_name not in ('todo_id', 'user_id', 'memo', 'subtasks', 'updated_at')
  loop
    if c.column_name = any(pk_cols) then
      -- PK는 NOT NULL을 풀 수 없으므로 기본값을 부여
      if c.data_type = 'uuid' then
        execute format('alter table public.todo_details alter column %I set default gen_random_uuid()', c.column_name);
        raise notice 'todo_details.% : 기본값 gen_random_uuid() 설정', c.column_name;
      elsif c.data_type in ('bigint', 'integer', 'smallint') then
        execute format('create sequence if not exists public.%I owned by public.todo_details.%I',
                       'todo_details_' || c.column_name || '_seq', c.column_name);
        execute format('select setval(%L, coalesce((select max(%I) from public.todo_details), 0) + 1, false)',
                       'public.todo_details_' || c.column_name || '_seq', c.column_name);
        execute format('alter table public.todo_details alter column %I set default nextval(%L)',
                       c.column_name, 'public.todo_details_' || c.column_name || '_seq');
        raise notice 'todo_details.% : 시퀀스 기본값 설정', c.column_name;
      else
        raise warning 'todo_details.% (%) : PK 기본값을 수동으로 지정해야 합니다', c.column_name, c.data_type;
      end if;
    else
      execute format('alter table public.todo_details alter column %I drop not null', c.column_name);
      raise notice 'todo_details.% : NOT NULL 해제', c.column_name;
    end if;
  end loop;
end $$;

-- ── 4) todo_id unique (중복은 최신 1행만 남김) ──
delete from public.todo_details a
 using public.todo_details b
 where a.todo_id = b.todo_id
   and (coalesce(a.updated_at, '-infinity'), a.ctid) < (coalesce(b.updated_at, '-infinity'), b.ctid);
create unique index if not exists todo_details_todo_id_key on public.todo_details (todo_id);

-- ── user_id 기본값 + 비어 있으면 현재 사용자로 ──
alter table public.todo_details alter column user_id set default auth.uid();

create or replace function public.fill_user_id()
returns trigger language plpgsql security invoker as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists todo_details_fill_user_id on public.todo_details;
create trigger todo_details_fill_user_id before insert on public.todo_details
  for each row execute function public.fill_user_id();

-- ── updated_at 자동 갱신 ──
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists todo_details_touch on public.todo_details;
create trigger todo_details_touch before update on public.todo_details
  for each row execute function public.touch_updated_at();

-- ── 5) RLS + 권한 ──
alter table public.todo_details enable row level security;
grant select, insert, update, delete on public.todo_details to authenticated;

drop policy if exists "todo_details: owner only" on public.todo_details;
create policy "todo_details: owner only" on public.todo_details
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.todos t
                 where t.id = todo_details.todo_id and t.user_id = (select auth.uid()))
  );

commit;

-- PostgREST 스키마 캐시 갱신 (새 컬럼·제약이 API에 바로 반영되도록)
notify pgrst, 'reload schema';

-- ── 확인용 ──
-- 아래 결과에 is_nullable = 'NO' 이면서 column_default가 비어 있는 행은 todo_id·user_id·memo·subtasks·updated_at 외에 없어야 합니다.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'todo_details'
 order by ordinal_position;
