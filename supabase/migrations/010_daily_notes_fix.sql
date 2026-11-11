-- Daily Memopad 서버 저장 실패 해결용 마이그레이션.
-- 앱은 { user_id, date, content }를 upsert(on conflict user_id,date) 하고 content, updated_at을 읽습니다.
-- 실제 테이블(daily_notes 또는 기존 daily_memos)을 찾아 그 자리에서 앱 구조로 맞춥니다.
--   - 테이블이 아예 없으면 daily_notes 생성
--   - date/content/updated_at/user_id 컬럼 보장, 레거시 날짜 컬럼(note_date·memo_date) 값 이전
--   - 앱이 보내지 않는 레거시 NOT NULL 컬럼 해제 (insert가 23502로 막히지 않게)
--   - (user_id, date) unique, user_id 자동 채움, updated_at 자동 갱신, RLS + 권한
--   - 행을 지우지 않음: 날짜 없는 행·중복 행이 있으면 해당 제약만 건너뛰고 경고
-- Supabase SQL Editor에서 통째로 실행하세요. 여러 번 실행해도 안전합니다.

begin;

do $$
declare
  t text;
  c record;
  pk_cols text[];
  n bigint;
begin
  -- 대상 테이블 결정 (데이터가 있는 기존 테이블을 우선)
  if to_regclass('public.daily_notes') is not null then
    t := 'daily_notes';
  elsif to_regclass('public.daily_memos') is not null then
    t := 'daily_memos';
  else
    create table public.daily_notes (
      id         uuid primary key default gen_random_uuid(),
      user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
      date       date not null,
      content    text not null default '',
      updated_at timestamptz not null default now()
    );
    t := 'daily_notes';
  end if;
  raise notice '대상 테이블: public.%', t;

  -- 앱 컬럼 보장
  execute format('alter table public.%I add column if not exists user_id uuid references auth.users (id) on delete cascade', t);
  execute format('alter table public.%I add column if not exists date date', t);
  execute format('alter table public.%I add column if not exists content text', t);
  execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);

  -- 레거시 날짜 컬럼 → date
  for c in select column_name from information_schema.columns
            where table_schema = 'public' and table_name = t and column_name in ('note_date', 'memo_date')
  loop
    execute format('update public.%I set date = %I::date where date is null and %I is not null', t, c.column_name, c.column_name);
  end loop;
  -- 레거시 내용 컬럼(memo·body·text) → content
  for c in select column_name from information_schema.columns
            where table_schema = 'public' and table_name = t and column_name in ('memo', 'body', 'text')
  loop
    execute format('update public.%I set content = %I::text where content is null and %I is not null', t, c.column_name, c.column_name);
  end loop;

  execute format('update public.%I set content = '''' where content is null', t);
  execute format('alter table public.%I alter column content set default ''''', t);
  execute format('alter table public.%I alter column content set not null', t);
  -- 날짜를 알 수 없는 행은 지우지 않음 (그런 행이 있으면 NOT NULL만 건너뜀)
  execute format('select count(*) from public.%I where date is null', t) into n;
  if n = 0 then
    execute format('alter table public.%I alter column date set not null', t);
  else
    raise warning '%: date가 비어 있는 행 %건이 있어 date NOT NULL을 건너뜁니다 (데이터는 그대로 둠)', t, n;
  end if;
  execute format('alter table public.%I alter column user_id set default auth.uid()', t);

  -- 앱이 보내지 않는 NOT NULL·기본값 없는 컬럼 해제 (PK는 기본값 부여)
  select coalesce(array_agg(a.attname::text), '{}') into pk_cols
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = format('public.%I', t)::regclass and i.indisprimary;

  for c in select column_name, data_type from information_schema.columns
            where table_schema = 'public' and table_name = t
              and is_nullable = 'NO' and column_default is null
              and is_identity = 'NO' and is_generated = 'NEVER'
              and column_name not in ('user_id', 'date', 'content', 'updated_at')
  loop
    if c.column_name = any(pk_cols) then
      if c.data_type = 'uuid' then
        execute format('alter table public.%I alter column %I set default gen_random_uuid()', t, c.column_name);
      else
        raise warning '%.% (%) : PK 기본값을 수동으로 지정해야 합니다', t, c.column_name, c.data_type;
      end if;
    else
      execute format('alter table public.%I alter column %I drop not null', t, c.column_name);
      raise notice '%.% : NOT NULL 해제', t, c.column_name;
    end if;
  end loop;

  -- (user_id, date) unique: 중복 행이 있으면 지우지 않고 건너뜀
  --   (앱은 unique가 없으면 update → insert 방식으로 저장하므로 동작에는 지장 없음)
  execute format(
    'select count(*) from (select 1 from public.%I where date is not null group by user_id, date having count(*) > 1) d', t)
    into n;
  if n = 0 then
    execute format('create unique index if not exists %I on public.%I (user_id, date)', t || '_user_date_key', t);
  else
    raise warning '%: 같은 날짜 메모가 중복된 경우가 %건 있어 unique 인덱스를 건너뜁니다. 직접 정리 후 다시 실행하세요.', t, n;
  end if;

  -- user_id 자동 채움 + 레거시 날짜 컬럼 동기화 + updated_at 갱신
  execute format($f$
    create or replace function public.%1$I()
    returns trigger language plpgsql as $body$
    begin
      if new.user_id is null then new.user_id := auth.uid(); end if;
      new.updated_at := now();
      return new;
    end $body$;$f$, t || '_before_write');
  execute format('drop trigger if exists %I on public.%I', t || '_before_write', t);
  execute format('create trigger %I before insert or update on public.%I for each row execute function public.%I()',
                 t || '_before_write', t, t || '_before_write');

  for c in select column_name from information_schema.columns
            where table_schema = 'public' and table_name = t and column_name in ('note_date', 'memo_date')
  loop
    execute format($f$
      create or replace function public.%1$I()
      returns trigger language plpgsql as $body$
      begin
        new.%2$I := new.date;
        return new;
      end $body$;$f$, t || '_sync_' || c.column_name, c.column_name);
    execute format('drop trigger if exists %I on public.%I', t || '_sync_' || c.column_name, t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.%I()',
                   t || '_sync_' || c.column_name, t, t || '_sync_' || c.column_name);
  end loop;

  -- RLS + 권한
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from anon', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  execute format('drop policy if exists %I on public.%I', t || ': owner only', t);
  execute format(
    'create policy %I on public.%I for all to authenticated
       using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
    t || ': owner only', t);
end $$;

commit;

notify pgrst, 'reload schema';

-- 확인용: 아래 결과에 date·content·user_id·updated_at이 있고, 앱이 보내지 않는 컬럼 중
--         is_nullable = 'NO' 이면서 column_default가 비어 있는 행이 없어야 합니다.
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name in ('daily_notes', 'daily_memos')
 order by table_name, ordinal_position;
